import * as path from "node:path";
import { IDE, ILLM, ChatMessage, Chunk, BranchAndDir } from "../index.js";
import { localPathToUri, localPathOrUriToPath } from "./pathToUri.js";
import { FullTextSearchCodebaseIndex } from "../indexing/FullTextSearchCodebaseIndex.js";
import { LanceDbIndex } from "../indexing/LanceDbIndex.js";
import { chunkDocument } from "../indexing/chunk/chunk.js";

// 按照原始Python代码的接口定义
export interface CodeChunk {
  file_path: string;
  start_line: number;
  chunk: string;
}

export interface ScoredChunk {
  file: string;
  start_line: number;
  score: number;
  code: string;
  module?: string; // 可选的模块信息
}

export interface RelevanceScore {
  file: string;
  start_line: number;
  score: number;
}

export interface ModuleFileMap {
  [moduleName: string]: string[];
}

export interface SnippetFilterEvaluation {
  file: string;
  start_line: number;
  is_relevant: boolean;
  reason?: string;
}

// Tool 调用结果存储
interface ToolCallResults {
  relevanceScores?: RelevanceScore[] | undefined;
  filterResults?: SnippetFilterEvaluation[] | undefined;
}

/**
 * 智能并发管理器
 */
class ConcurrencyManager {
  private maxConcurrency: number;
  private currentConcurrency = 0;
  private queue: Array<() => Promise<any>> = [];
  private avgResponseTime = 0;
  private errorCount = 0;
  private totalRequests = 0;
  private responseTimeSum = 0;

  constructor(maxConcurrency: number = 4) {
    this.maxConcurrency = maxConcurrency;
  }

  async execute<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const startTime = Date.now();
          const result = await task();
          this.updateMetrics(Date.now() - startTime, false);
          resolve(result);
        } catch (error) {
          this.updateMetrics(0, true);
          reject(error);
        }
      });
      this.processQueue();
    });
  }

  private async processQueue() {
    if (
      this.currentConcurrency >= this.maxConcurrency ||
      this.queue.length === 0
    ) {
      return;
    }

    this.currentConcurrency++;
    const task = this.queue.shift()!;

    try {
      await task();
    } finally {
      this.currentConcurrency--;
      // 根据性能动态调整延迟
      const delay = this.calculateDelay();
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      this.processQueue();
    }
  }

  private updateMetrics(responseTime: number, isError: boolean) {
    this.totalRequests++;
    if (isError) {
      this.errorCount++;
    } else {
      this.responseTimeSum += responseTime;
      this.avgResponseTime =
        this.responseTimeSum / (this.totalRequests - this.errorCount);
    }
  }

  private calculateDelay(): number {
    const errorRate = this.errorCount / this.totalRequests;

    // 根据错误率和响应时间计算延迟
    if (errorRate > 0.3) return 3000; // 错误率高时增加延迟
    if (errorRate > 0.1) return 1500; // 错误率中等时适度延迟
    if (this.avgResponseTime > 15000) return 1000; // 响应很慢时增加延迟
    if (this.avgResponseTime > 8000) return 500; // 响应慢时适度延迟
    return 200; // 基础延迟
  }

  getStats() {
    return {
      totalRequests: this.totalRequests,
      errorCount: this.errorCount,
      errorRate:
        this.totalRequests > 0 ? this.errorCount / this.totalRequests : 0,
      avgResponseTime: this.avgResponseTime,
      currentConcurrency: this.currentConcurrency,
      queueLength: this.queue.length,
    };
  }
}

export class CodeSnippetAnalyzer {
  protected maxChunkSize: number;
  private systemPrompt: string;
  private filterSystemPrompt: string;
  private concurrencyManager: ConcurrencyManager;
  private toolCallResults: ToolCallResults = {
    relevanceScores: undefined,
    filterResults: undefined,
  };

  // 添加高级检索索引
  private ftsIndex: FullTextSearchCodebaseIndex;
  private lanceDbIndex: LanceDbIndex | null = null;

  constructor(
    protected ide: IDE,
    protected llm?: ILLM,
    maxChunkSize: number = 800,
    maxConcurrency: number = 4,
  ) {
    this.maxChunkSize = maxChunkSize;
    this.concurrencyManager = new ConcurrencyManager(maxConcurrency);

    // 设置 XML 格式的提示词
    this.systemPrompt = this.getSystemPrompt();
    this.filterSystemPrompt = this.getFilterSystemPrompt();

    // 初始化检索索引
    this.ftsIndex = new FullTextSearchCodebaseIndex();
    this.initLanceDb();
  }

  /**
   * 初始化向量数据库索引
   */
  private async initLanceDb() {
    if (this.llm) {
      try {
        this.lanceDbIndex = await LanceDbIndex.create(this.llm, (uri) =>
          this.ide.readFile(uri),
        );
      } catch (error) {
        console.warn("LanceDB 初始化失败，将跳过向量检索:", error);
      }
    }
  }

  /**
   * 获取评分系统提示词
   */
  private getSystemPrompt(): string {
    return `
You are a senior code analysis expert. Analyze code snippets for relevance to user requirements.

TASK: Evaluate each code snippet with a score from 0-10 (10=most relevant).

SCORING CRITERIA:
- Relevant functionality/methods: High score
- Relevant configuration/constants: High score
- Relevant keywords/variables: Medium score
- Related comments/documentation: Medium score
- Generic code/imports only: Low score

OUTPUT FORMAT:
You MUST respond with ONLY this exact XML format:
<scores>
<score file="file_path" line="start_line" value="score_value" />
<score file="file_path" line="start_line" value="score_value" />
</scores>

IMPORTANT RULES:
1. Use forward slashes (/) in ALL file paths
2. Include ALL code snippets in your response
3. No additional text or explanations
4. Ensure valid XML format

Example:
<scores>
<score file="src/main/java/Example.java" line="10" value="8" />
<score file="src/main/java/Other.java" line="25" value="6" />
</scores>
        `;
  }

  /**
   * 获取过滤系统提示词
   */
  private getFilterSystemPrompt(): string {
    return `
You are a code analysis expert. Filter code snippets based on relevance to user requirements.

TASK: Evaluate each code snippet and determine if it's relevant.

RELEVANCE CRITERIA:
- Implements mentioned functionality: RELEVANT
- Contains related class/method/variable names: RELEVANT
- Contains related configuration/constants: RELEVANT
- Contains related comments/documentation: RELEVANT
- Only imports/boilerplate/generic utilities: NOT RELEVANT
- Completely unrelated functionality: NOT RELEVANT

OUTPUT FORMAT:
You MUST respond with ONLY this exact XML format:
<filters>
<filter file="file_path" line="start_line" relevant="true_or_false" reason="brief_reason" />
<filter file="file_path" line="start_line" relevant="true_or_false" reason="brief_reason" />
</filters>

IMPORTANT RULES:
1. Use forward slashes (/) in ALL file paths
2. Include ALL code snippets in your response
3. No additional text or explanations
4. Ensure valid XML format

Example:
<filters>
<filter file="src/main/java/Example.java" line="10" relevant="true" reason="implements cache functionality" />
<filter file="src/main/java/Other.java" line="25" relevant="false" reason="only imports and boilerplate" />
</filters>
        `;
  }

  /**
   * 安全地将路径转换为 URI，确保不会重复转换
   */
  private safePathToUri(pathOrUri: string): string {
    // 如果已经是 URI 格式，直接返回
    if (pathOrUri.startsWith("file://")) {
      return pathOrUri;
    }
    // 否则转换为 URI
    return localPathToUri(pathOrUri);
  }

  /**
   * Tool: 提交代码相关性评分结果
   */
  private submitCodeRelevanceScores = (scores: RelevanceScore[]): string => {
    // 验证输入
    if (!Array.isArray(scores)) {
      throw new Error("scores 必须是数组");
    }

    for (const score of scores) {
      if (
        !score.file ||
        typeof score.start_line !== "number" ||
        typeof score.score !== "number"
      ) {
        throw new Error(
          "每个评分对象必须包含 file (string), start_line (number), score (number)",
        );
      }
      if (score.score < 0 || score.score > 10) {
        throw new Error("评分必须在 0-10 之间");
      }
    }

    // 存储结果 - 明确类型赋值
    this.toolCallResults.relevanceScores = scores as RelevanceScore[];

    return "评分结果已成功提交";
  };

  /**
   * Tool: 提交代码片段过滤结果
   */
  private submitSnippetFilterResults = (
    evaluations: SnippetFilterEvaluation[],
  ): string => {
    // 验证输入
    if (!Array.isArray(evaluations)) {
      throw new Error("evaluations 必须是数组");
    }

    for (const evaluation of evaluations) {
      if (
        !evaluation.file ||
        typeof evaluation.start_line !== "number" ||
        typeof evaluation.is_relevant !== "boolean"
      ) {
        throw new Error(
          "每个评估对象必须包含 file (string), start_line (number), is_relevant (boolean)",
        );
      }
    }

    // 存储结果 - 明确类型赋值
    this.toolCallResults.filterResults =
      evaluations as SnippetFilterEvaluation[];

    return "过滤结果已成功提交";
  };

  /**
   * 解析 XML 格式的评分结果
   */
  private parseXmlScores(content: string): RelevanceScore[] {
    const scores: RelevanceScore[] = [];

    // 多种 XML 格式模式
    const patterns = [
      // 自闭合标签，任意属性顺序
      /<score[^>]*?file\s*=\s*["']([^"']*?)["'][^>]*?line\s*=\s*["']?(\d+)["']?[^>]*?value\s*=\s*["']?([\d.]+)["']?[^>]*?\/>/gi,
      /<score[^>]*?line\s*=\s*["']?(\d+)["']?[^>]*?file\s*=\s*["']([^"']*?)["'][^>]*?value\s*=\s*["']?([\d.]+)["']?[^>]*?\/>/gi,
      /<score[^>]*?value\s*=\s*["']?([\d.]+)["']?[^>]*?file\s*=\s*["']([^"']*?)["'][^>]*?line\s*=\s*["']?(\d+)["']?[^>]*?\/>/gi,

      // 开闭标签格式
      /<score[^>]*?file\s*=\s*["']([^"']*?)["'][^>]*?line\s*=\s*["']?(\d+)["']?[^>]*?value\s*=\s*["']?([\d.]+)["']?[^>]*?>\s*<\/score>/gi,

      // 简化格式（只有必需属性）
      /<score[^>]*?file\s*=\s*["']([^"']*?)["'][^>]*?line\s*=\s*["']?(\d+)["']?[^>]*?value\s*=\s*["']?([\d.]+)["']?[^>]*?\/?>/gi,
    ];

    // 尝试每种模式
    for (const pattern of patterns) {
      const matches = [...content.matchAll(pattern)];

      for (const match of matches) {
        let file: string, startLine: number, score: number;

        // 根据匹配组的顺序提取数据
        if (pattern.source.includes("file.*?line.*?value")) {
          // file, line, value 顺序
          file = match[1];
          startLine = parseInt(match[2]);
          score = parseFloat(match[3]);
        } else if (pattern.source.includes("line.*?file.*?value")) {
          // line, file, value 顺序
          startLine = parseInt(match[1]);
          file = match[2];
          score = parseFloat(match[3]);
        } else if (pattern.source.includes("value.*?file.*?line")) {
          // value, file, line 顺序
          score = parseFloat(match[1]);
          file = match[2];
          startLine = parseInt(match[3]);
        } else {
          // 默认 file, line, value 顺序
          file = match[1];
          startLine = parseInt(match[2]);
          score = parseFloat(match[3]);
        }

        // 标准化文件路径
        file = file.replace(/\\/g, "/");

        // 验证数据
        if (file && file.includes(".") && !isNaN(startLine) && !isNaN(score)) {
          scores.push({
            file: file,
            start_line: startLine,
            score: Math.max(0, Math.min(10, score)),
          });
        }
      }

      // 如果找到了结果，就不再尝试其他模式
      if (scores.length > 0) {
        break;
      }
    }

    // 如果没有找到标准格式，尝试更宽松的解析
    if (scores.length === 0) {
      const loosePattern = /<score[^>]*>/gi;
      const scoreElements = [...content.matchAll(loosePattern)];

      for (const element of scoreElements) {
        const scoreTag = element[0];

        // 提取属性
        const fileMatch = scoreTag.match(/file\s*=\s*["']([^"']*?)["']/i);
        const lineMatch = scoreTag.match(/line\s*=\s*["']?(\d+)["']?/i);
        const valueMatch = scoreTag.match(/value\s*=\s*["']?([\d.]+)["']?/i);

        if (fileMatch && lineMatch && valueMatch) {
          const file = fileMatch[1].replace(/\\/g, "/");
          const startLine = parseInt(lineMatch[1]);
          const score = parseFloat(valueMatch[1]);

          if (
            file &&
            file.includes(".") &&
            !isNaN(startLine) &&
            !isNaN(score)
          ) {
            scores.push({
              file: file,
              start_line: startLine,
              score: Math.max(0, Math.min(10, score)),
            });
          }
        }
      }
    }

    return scores;
  }

  /**
   * 解析 XML 格式的过滤结果
   */
  private parseXmlFilter(content: string): SnippetFilterEvaluation[] {
    const evaluations: SnippetFilterEvaluation[] = [];

    // 检查是否包含期望的XML结构
    const hasFiltersTag = content.includes("<filters>");
    const hasFilterTag = content.includes("<filter");
    const hasFileAttr = content.includes("file=");
    const hasLineAttr = content.includes("line=");
    const hasRelevantAttr = content.includes("relevant=");
    const hasReasonAttr = content.includes("reason=");

    // 多种 XML 过滤格式模式 - 支持任意属性顺序
    const patterns = [
      // file, line, reason, relevant 顺序（LLM 实际输出的顺序）
      /<filter[^>]*?file\s*=\s*["']([^"']*?)["'][^>]*?line\s*=\s*["']?(\d+)["']?[^>]*?reason\s*=\s*["']([^"']*?)["'][^>]*?relevant\s*=\s*["']?(true|false)["']?[^>]*?\/>/gi,

      // file, line, relevant, reason 顺序（标准顺序）
      /<filter[^>]*?file\s*=\s*["']([^"']*?)["'][^>]*?line\s*=\s*["']?(\d+)["']?[^>]*?relevant\s*=\s*["']?(true|false)["']?[^>]*?reason\s*=\s*["']([^"']*?)["'][^>]*?\/>/gi,

      // 开闭标签格式 - file, line, reason, relevant
      /<filter[^>]*?file\s*=\s*["']([^"']*?)["'][^>]*?line\s*=\s*["']?(\d+)["']?[^>]*?reason\s*=\s*["']([^"']*?)["'][^>]*?relevant\s*=\s*["']?(true|false)["']?[^>]*?>\s*<\/filter>/gi,

      // 开闭标签格式 - file, line, relevant, reason
      /<filter[^>]*?file\s*=\s*["']([^"']*?)["'][^>]*?line\s*=\s*["']?(\d+)["']?[^>]*?relevant\s*=\s*["']?(true|false)["']?[^>]*?reason\s*=\s*["']([^"']*?)["'][^>]*?>\s*<\/filter>/gi,
    ];

    // 尝试每种模式
    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];
      const matches = [...content.matchAll(pattern)];

      for (const match of matches) {
        let file: string,
          startLine: number,
          isRelevant: boolean,
          reason: string;

        // 根据模式索引确定参数顺序
        if (i === 0 || i === 2) {
          // file, line, reason, relevant 顺序
          file = match[1].replace(/\\/g, "/");
          startLine = parseInt(match[2]);
          reason = match[3] || "无理由";
          isRelevant = match[4].toLowerCase() === "true";
        } else {
          // file, line, relevant, reason 顺序
          file = match[1].replace(/\\/g, "/");
          startLine = parseInt(match[2]);
          isRelevant = match[3].toLowerCase() === "true";
          reason = match[4] || "无理由";
        }

        if (file && file.includes(".") && !isNaN(startLine)) {
          evaluations.push({
            file: file,
            start_line: startLine,
            is_relevant: isRelevant,
            reason: reason,
          });
        } else {
          console.warn(`⚠️ 跳过无效的XML过滤: file=${file}, line=${startLine}`);
        }
      }

      // 如果找到了结果，就不再尝试其他模式
      if (evaluations.length > 0) {
        break;
      }
    }

    // 如果没有找到标准格式，尝试更宽松的解析
    if (evaluations.length === 0) {
      const loosePattern = /<filter[^>]*>/gi;
      const filterElements = [...content.matchAll(loosePattern)];

      for (const element of filterElements) {
        const filterTag = element[0];

        // 提取属性
        const fileMatch = filterTag.match(/file\s*=\s*["']([^"']*?)["']/i);
        const lineMatch = filterTag.match(/line\s*=\s*["']?(\d+)["']?/i);
        const relevantMatch = filterTag.match(
          /relevant\s*=\s*["']?(true|false)["']?/i,
        );
        const reasonMatch = filterTag.match(/reason\s*=\s*["']([^"']*?)["']/i);

        if (fileMatch && lineMatch && relevantMatch) {
          const file = fileMatch[1].replace(/\\/g, "/");
          const startLine = parseInt(lineMatch[1]);
          const isRelevant = relevantMatch[1].toLowerCase() === "true";
          const reason = reasonMatch ? reasonMatch[1] : "无理由";

          if (file && file.includes(".") && !isNaN(startLine)) {
            evaluations.push({
              file: file,
              start_line: startLine,
              is_relevant: isRelevant,
              reason: reason,
            });
          }
        }
      }
    }

    if (evaluations.length === 0) {
      console.error("❌ XML过滤解析失败，未找到任何有效的filter标签");
      console.error("📄 完整响应内容:", content);
    }

    return evaluations;
  }

  /**
   * 从 LLM 响应中提取 XML 格式的参数
   */
  private extractToolCallArgs(content: string, functionName: string): any {
    // 使用 XML 格式解析
    try {
      if (functionName === "submitCodeRelevanceScores") {
        const scores = this.parseXmlScores(content);
        if (scores.length > 0) {
          return { scores };
        } else {
          console.warn(`⚠️ 评分XML解析返回空结果`);
        }
      } else if (functionName === "submitSnippetFilterResults") {
        const evaluations = this.parseXmlFilter(content);
        if (evaluations.length > 0) {
          return { evaluations };
        } else {
          console.warn(`⚠️ 过滤XML解析返回空结果`);
        }
      }
    } catch (error) {
      console.error(
        `❌ XML格式解析异常: ${error instanceof Error ? error.message : String(error)}`,
      );
      console.error(`📄 解析失败的内容: ${content.substring(0, 500)}...`);
    }

    throw new Error(`无法从响应中提取 ${functionName} 的 XML 参数`);
  }

  /**
   * 读取文件并分割成代码块 (对应Python的read_file_chunks函数)
   */
  async readFileChunks(filePath: string): Promise<CodeChunk[]> {
    try {
      const fileUri = this.safePathToUri(filePath);
      const content = await this.ide.readFile(fileUri);

      if (!content.trim()) {
        console.warn(`文件 ${filePath} 为空`);
        return [];
      }

      const lines = content.split("\n");
      const chunks: CodeChunk[] = [];
      let currentChunk: string[] = [];
      let currentLine = 0;
      let startLine = 1;
      let braceCount = 0;
      let inBlock = false;

      for (let i = 0; i < lines.length; i++) {
        currentLine = i + 1;
        const line = lines[i];
        braceCount +=
          (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;

        if (braceCount > 0 && !inBlock) {
          inBlock = true;
        } else if (braceCount === 0 && inBlock) {
          inBlock = false;
        }

        currentChunk.push(line);
        const chunkText = currentChunk.join("\n");

        if (chunkText.length >= this.maxChunkSize && !inBlock) {
          chunks.push({
            file_path: filePath,
            start_line: startLine,
            chunk: chunkText,
          });
          startLine = currentLine + 1;
          currentChunk = [];
          braceCount = 0;
        }
      }

      if (currentChunk.length > 0) {
        chunks.push({
          file_path: filePath,
          start_line: startLine,
          chunk: currentChunk.join("\n"),
        });
      }

      return chunks;
    } catch (error) {
      console.error(
        `读取文件 ${filePath} 失败: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * 评估代码块的相关性 (对应Python的evaluate_relevance函数)
   */
  async evaluateRelevance(
    userRequest: string,
    codeChunks: CodeChunk[],
  ): Promise<RelevanceScore[]> {
    if (!codeChunks.length) {
      return [];
    }

    // 预过滤：使用关键词匹配
    const keywords = userRequest.toLowerCase().match(/\w+/g) || [];
    const filteredChunks = codeChunks.filter((chunk) =>
      keywords.some((keyword) => chunk.chunk.toLowerCase().includes(keyword)),
    );

    // 如果没有匹配的块，回退到所有块
    const chunksToAnalyze =
      filteredChunks.length > 0 ? filteredChunks : codeChunks;

    const chunkDescriptions = chunksToAnalyze.map(
      (chunk, index) =>
        `【Code Chunk ${index + 1}】File: ${chunk.file_path}\nStart Line: ${chunk.start_line}\nContent:\n\`\`\`java\n${chunk.chunk.substring(0, 1500)}...\n\`\`\``,
    );

    const userContent = `Requirement Analysis:\n${userRequest}\n\nCode Snippets:\n${chunkDescriptions.join("\n\n")}`;

    if (!this.llm) {
      throw new Error("LLM not available for relevance evaluation");
    }

    // 创建带超时的 AbortController
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, 30000); // 30秒超时

    try {
      // 重置之前的结果
      this.toolCallResults.relevanceScores = undefined;

      // 定义工具
      const tools = [
        {
          type: "function",
          function: {
            name: "submitCodeRelevanceScores",
            description: "提交代码相关性评分结果",
            parameters: {
              type: "object",
              properties: {
                scores: {
                  type: "array",
                  description: "代码片段评分结果数组",
                  items: {
                    type: "object",
                    properties: {
                      file: {
                        type: "string",
                        description: "文件路径",
                      },
                      start_line: {
                        type: "number",
                        description: "代码片段起始行号",
                      },
                      score: {
                        type: "number",
                        description: "相关性评分 (0-10)",
                      },
                    },
                    required: ["file", "start_line", "score"],
                  },
                },
              },
              required: ["scores"],
            },
          },
        },
      ];

      // 设置工具调用处理函数
      const toolCallHandlers = {
        submitCodeRelevanceScores: this.submitCodeRelevanceScores,
      };

      const messages: ChatMessage[] = [
        {
          role: "system",
          content: this.systemPrompt.replace("{user_request}", userRequest),
        },
        { role: "user", content: userContent },
      ];

      // 使用支持工具调用的 LLM 接口
      const response = await this.llm.chat(messages, abortController.signal, {
        temperature: 0.0,
        maxTokens: 4096,
        // 注意：这里的 tools 和 tool_choice 可能在某些 LLM 实现中不支持
        // 我们将在内容中解析结果
      });

      clearTimeout(timeoutId);

      // 使用统一的提取方法处理所有格式
      const content = response.content;
      if (typeof content === "string") {
        try {
          const args = this.extractToolCallArgs(
            content,
            "submitCodeRelevanceScores",
          );

          if (args.scores && Array.isArray(args.scores)) {
            this.submitCodeRelevanceScores(args.scores);
          } else {
            console.warn("工具调用参数中缺少 scores 数组");
          }
        } catch (extractError) {
          console.error(
            "从内容中提取工具调用失败:",
            extractError instanceof Error
              ? extractError.message
              : String(extractError),
          );
        }
      }

      // 检查是否有工具调用结果
      const relevanceScores = this.toolCallResults.relevanceScores;
      if (relevanceScores && Array.isArray(relevanceScores)) {
        const scores = relevanceScores as RelevanceScore[];
        if (scores.length > 0) {
          // 标准化分数
          const maxScore = Math.max(...scores.map((s) => s.score));
          if (maxScore > 0) {
            scores.forEach((s) => {
              s.score = (s.score / maxScore) * 10; // 标准化到 0-10
            });
          }

          return scores;
        } else {
          // 如果工具调用结果为空数组，返回默认评分
          console.warn("工具调用结果为空数组，返回默认评分");
          return chunksToAnalyze.map((chunk) => ({
            file: chunk.file_path,
            start_line: chunk.start_line,
            score: 5, // 默认中等评分
          }));
        }
      } else {
        // 如果 XML 解析失败，返回默认评分
        console.warn("无法获取 XML 评分结果，返回默认评分");
        return chunksToAnalyze.map((chunk) => ({
          file: chunk.file_path,
          start_line: chunk.start_line,
          score: 5, // 默认中等评分
        }));
      }
    } catch (error) {
      clearTimeout(timeoutId);
      console.error(
        `LLM API 错误: ${error instanceof Error ? error.message : String(error)}`,
      );

      // 如果是超时错误，提供更具体的信息
      if (error instanceof Error && error.name === "AbortError") {
        console.error("LLM API 调用超时 (30秒)");
      }

      // 返回默认分数
      return chunksToAnalyze.map((chunk) => ({
        file: chunk.file_path,
        start_line: chunk.start_line,
        score: 0,
      }));
    }
  }

  /**
   * 高级代码片段选取功能 - 当过滤后没有结果时的备选方案
   * 参考 NoRerankerRetrievalPipeline 的多种检索策略
   */
  private async getFallbackSnippets(
    moduleFileMap: ModuleFileMap,
    userRequest: string,
    basePath: string,
    topN: number = 3,
  ): Promise<ScoredChunk[]> {
    console.log("🔍 启动高级备选检索策略...");

    const workspaceDirs = await this.ide.getWorkspaceDirs();
    const tags: BranchAndDir[] = workspaceDirs.map(dir => ({
      directory: dir,
      branch: "main" // 默认分支
    }));

    // 分配权重：25% FTS, 25% 向量搜索, 25% 最近文件, 25% 关键词匹配
    const ftsN = Math.ceil(topN * 0.25);
    const embeddingsN = Math.ceil(topN * 0.25);
    const recentN = Math.ceil(topN * 0.25);
    const keywordN = topN - ftsN - embeddingsN - recentN;

    let allResults: ScoredChunk[] = [];

    // 策略1: 全文搜索 (FTS)
    try {
      const ftsChunks = await this.retrieveFts(userRequest, ftsN, tags);
      const ftsResults = this.convertChunksToScoredChunks(ftsChunks, "FTS", 0.8);
      allResults.push(...ftsResults);
      console.log(`📄 FTS 检索获得 ${ftsResults.length} 个片段`);
    } catch (error) {
      console.warn("FTS 检索失败:", error);
    }

    // 策略2: 向量嵌入搜索
    if (this.lanceDbIndex) {
      try {
        const embeddingChunks = await this.lanceDbIndex.retrieve(
          userRequest,
          embeddingsN,
          tags,
          undefined
        );
        const embeddingResults = this.convertChunksToScoredChunks(embeddingChunks, "Embeddings", 0.9);
        allResults.push(...embeddingResults);
        console.log(`🧠 向量检索获得 ${embeddingResults.length} 个片段`);
      } catch (error) {
        console.warn("向量检索失败:", error);
      }
    }

    // 策略3: 最近编辑的文件
    try {
      const recentChunks = await this.retrieveRecentlyEditedFiles(recentN);
      const recentResults = this.convertChunksToScoredChunks(recentChunks, "Recent", 0.6);
      allResults.push(...recentResults);
      console.log(`⏰ 最近文件检索获得 ${recentResults.length} 个片段`);
    } catch (error) {
      console.warn("最近文件检索失败:", error);
    }

    // 策略4: 关键词匹配 (作为最后的备选)
    if (allResults.length < topN) {
      try {
        const keywordResults = await this.retrieveByKeywords(
          moduleFileMap,
          userRequest,
          basePath,
          Math.max(keywordN, topN - allResults.length)
        );
        allResults.push(...keywordResults);
        console.log(`🔤 关键词检索获得 ${keywordResults.length} 个片段`);
      } catch (error) {
        console.warn("关键词检索失败:", error);
      }
    }

    // 去重并智能选择
    const deduplicatedResults = this.deduplicateScoredChunks(allResults);
    const selectedResults = this.selectTopScoredChunksWithHighScorePreservation(deduplicatedResults, topN);

    console.log(`✅ 备选检索完成，返回 ${selectedResults.length} 个高质量片段`);
    return selectedResults;
  }

  /**
   * 全文搜索检索
   */
  private async retrieveFts(
    query: string,
    n: number,
    tags: BranchAndDir[]
  ): Promise<Chunk[]> {
    if (query.trim() === "") {
      return [];
    }

    // 清理查询文本，提取关键词
    const keywords = query.toLowerCase().match(/\w+/g) || [];
    const searchText = keywords.join(" OR ");

    return await this.ftsIndex.retrieve({
      n,
      text: searchText,
      tags,
    });
  }

  /**
   * 检索最近编辑的文件
   */
  private async retrieveRecentlyEditedFiles(n: number): Promise<Chunk[]> {
    const chunks: Chunk[] = [];

    try {
      // 获取最近打开的文件
      const openFiles = await this.ide.getOpenFiles();
      const filesToProcess = openFiles.slice(0, Math.min(n * 2, 10)); // 限制处理的文件数

      for (const filepath of filesToProcess) {
        try {
          const contents = await this.ide.readFile(filepath);
          const fileChunks = chunkDocument({
            filepath,
            contents,
            maxChunkSize: this.maxChunkSize,
            digest: filepath,
          });

          let chunkCount = 0;
          for await (const chunk of fileChunks) {
            if (chunkCount >= Math.ceil(n / filesToProcess.length)) break;
            chunks.push(chunk);
            chunkCount++;
          }
        } catch (error) {
          console.warn(`读取最近文件 ${filepath} 失败:`, error);
        }
      }
    } catch (error) {
      console.warn("获取最近文件失败:", error);
    }

    return chunks.slice(0, n);
  }

  /**
   * 基于关键词的简单检索
   */
  private async retrieveByKeywords(
    moduleFileMap: ModuleFileMap,
    userRequest: string,
    basePath: string,
    n: number
  ): Promise<ScoredChunk[]> {
    const results: ScoredChunk[] = [];
    const keywords = userRequest.toLowerCase().match(/\w+/g) || [];
    const keywordPattern = new RegExp(keywords.join('|'), 'i');

    for (const [moduleName, files] of Object.entries(moduleFileMap)) {
      if (results.length >= n) break;

      const filesToProcess = files.slice(0, Math.min(3, files.length));

      for (const file of filesToProcess) {
        if (results.length >= n) break;

        try {
          const filePath = path.join(basePath, moduleName, file);
          const fileUri = this.safePathToUri(filePath);

          if (await this.ide.fileExists(fileUri)) {
            const content = await this.ide.readFile(fileUri);

            // 关键词匹配评分
            const keywordMatches = (content.match(keywordPattern) || []).length;
            const score = Math.min(keywordMatches * 0.3, 3); // 最高3分

            if (score > 0) {
              const lines = content.split('\n');
              const chunkSize = Math.min(40, lines.length);
              const chunk = lines.slice(0, chunkSize).join('\n');

              results.push({
                file: filePath,
                start_line: 1,
                score: score,
                code: chunk,
                module: moduleName,
              });
            }
          }
        } catch (error) {
          console.warn(`关键词检索文件 ${file} 失败:`, error);
        }
      }
    }

    return results.slice(0, n);
  }

  /**
   * 将 Chunk 转换为 ScoredChunk
   */
  private convertChunksToScoredChunks(
    chunks: Chunk[],
    source: string,
    baseScore: number
  ): ScoredChunk[] {
    return chunks.map((chunk, index) => ({
      file: chunk.filepath,
      start_line: chunk.startLine || 1,
      score: baseScore - (index * 0.1), // 排序越靠前分数越高
      code: chunk.content,
      module: this.extractModuleFromPath(chunk.filepath),
    }));
  }

  /**
   * 从文件路径中提取模块名
   */
  private extractModuleFromPath(filepath: string): string {
    const normalizedPath = filepath.replace(/\\/g, "/");
    const pathParts = normalizedPath.split("/");

    // 尝试找到可能的模块名
    for (let i = pathParts.length - 2; i >= 0; i--) {
      const part = pathParts[i];
      if (part && !part.startsWith(".") && part !== "src" && part !== "main") {
        return part;
      }
    }

    return "未知模块";
  }

  /**
   * 去重 ScoredChunk 数组
   */
  private deduplicateScoredChunks(chunks: ScoredChunk[]): ScoredChunk[] {
    const seen = new Set<string>();
    const result: ScoredChunk[] = [];

    for (const chunk of chunks) {
      const key = `${chunk.file}:${chunk.start_line}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(chunk);
      }
    }

    return result;
  }

  /**
   * 智能路径匹配 - 支持更宽松的路径匹配逻辑
   * @param originalPath 原始文件路径
   * @param chunkPath LLM返回的文件路径
   * @param originalLine 原始起始行号
   * @param chunkLine LLM返回的起始行号
   */
  private isPathMatch(originalPath: string, chunkPath: string, originalLine: number, chunkLine: number): boolean {
    // 首先检查行号是否匹配
    if (originalLine !== chunkLine) {
      return false;
    }

    // 标准化路径 - 统一使用正斜杠
    const normalizedOrigPath = originalPath.replace(/\\/g, "/");
    const normalizedChunkPath = chunkPath.replace(/\\/g, "/");

    // 1. 完全匹配
    if (normalizedOrigPath === normalizedChunkPath) {
      return true;
    }

    // 2. 提取文件名进行匹配
    const origFileName = this.extractFileName(normalizedOrigPath);
    const chunkFileName = this.extractFileName(normalizedChunkPath);

    if (origFileName !== chunkFileName) {
      return false; // 文件名不同，肯定不匹配
    }

    // 3. 路径后缀匹配 - 检查是否是同一个文件的不同路径表示
    const origPathParts = normalizedOrigPath.split("/").filter(part => part.length > 0);
    const chunkPathParts = normalizedChunkPath.split("/").filter(part => part.length > 0);

    // 从后往前比较路径部分，允许前缀不同
    const minLength = Math.min(origPathParts.length, chunkPathParts.length);
    let matchCount = 0;

    for (let i = 1; i <= minLength; i++) {
      const origPart = origPathParts[origPathParts.length - i];
      const chunkPart = chunkPathParts[chunkPathParts.length - i];

      if (origPart === chunkPart) {
        matchCount++;
      } else {
        break;
      }
    }

    // 如果至少有2个路径部分匹配（包括文件名），认为是匹配的
    if (matchCount >= 2) {
      return true;
    }

    // 4. 模糊匹配 - 检查关键路径部分
    // 提取关键路径部分（去除常见的目录名）
    const commonDirs = new Set(['src', 'main', 'java', 'resources', 'test', 'target', 'classes']);
    const origKeyParts = origPathParts.filter(part => !commonDirs.has(part));
    const chunkKeyParts = chunkPathParts.filter(part => !commonDirs.has(part));

    // 检查关键部分是否有足够的重叠
    const origKeyPath = origKeyParts.join("/");
    const chunkKeyPath = chunkKeyParts.join("/");

    if (origKeyPath === chunkKeyPath && origKeyPath.length > 0) {
      return true;
    }

    // 5. 包含关系匹配 - 一个路径包含另一个路径
    if (normalizedOrigPath.includes(normalizedChunkPath) || normalizedChunkPath.includes(normalizedOrigPath)) {
      return true;
    }

    return false;
  }

  /**
   * 从路径中提取文件名
   */
  private extractFileName(filePath: string): string {
    const parts = filePath.split("/");
    return parts[parts.length - 1] || "";
  }

  /**
   * 智能选择代码片段 - 保留所有高分片段，不被topN严格限制
   * @param scores 评分数组
   * @param topN 建议的片段数量
   * @param highScoreThreshold 高分阈值，默认为9.0
   */
  private selectTopSnippetsWithHighScorePreservation(
    scores: RelevanceScore[],
    topN: number,
    highScoreThreshold: number = 9.0
  ): RelevanceScore[] {
    if (!scores.length) {
      return [];
    }

    // 按分数降序排序
    const sortedScores = scores.sort((a, b) => b.score - a.score);

    // 找到所有高分片段
    const highScoreSnippets = sortedScores.filter(score => score.score >= highScoreThreshold);

    if (highScoreSnippets.length > topN) {
      // 如果高分片段数量超过topN，保留所有高分片段
      console.log(`📈 发现 ${highScoreSnippets.length} 个高分片段(≥${highScoreThreshold})，超过topN(${topN})，保留所有高分片段`);
      return highScoreSnippets;
    } else if (highScoreSnippets.length === topN) {
      // 如果高分片段数量正好等于topN，直接返回
      return highScoreSnippets;
    } else {
      // 如果高分片段数量少于topN，补充其他片段到topN
      const remainingSlots = topN - highScoreSnippets.length;
      const otherSnippets = sortedScores
        .filter(score => score.score < highScoreThreshold)
        .slice(0, remainingSlots);

      const result = [...highScoreSnippets, ...otherSnippets];

      if (highScoreSnippets.length > 0) {
        console.log(`📊 保留 ${highScoreSnippets.length} 个高分片段 + ${otherSnippets.length} 个其他片段，共 ${result.length} 个`);
      }

      return result;
    }
  }

  /**
   * 智能选择ScoredChunk片段 - 保留所有高分片段
   * @param chunks ScoredChunk数组
   * @param topN 建议的片段数量
   * @param highScoreThreshold 高分阈值，默认为9.0
   */
  private selectTopScoredChunksWithHighScorePreservation(
    chunks: ScoredChunk[],
    topN: number,
    highScoreThreshold: number = 9.0
  ): ScoredChunk[] {
    if (!chunks.length) {
      return [];
    }

    // 按分数降序排序
    const sortedChunks = chunks.sort((a, b) => b.score - a.score);

    // 找到所有高分片段
    const highScoreChunks = sortedChunks.filter(chunk => chunk.score >= highScoreThreshold);

    if (highScoreChunks.length > topN) {
      // 如果高分片段数量超过topN，保留所有高分片段
      console.log(`📈 发现 ${highScoreChunks.length} 个高分片段(≥${highScoreThreshold})，超过topN(${topN})，保留所有高分片段`);
      return highScoreChunks;
    } else if (highScoreChunks.length === topN) {
      // 如果高分片段数量正好等于topN，直接返回
      return highScoreChunks;
    } else {
      // 如果高分片段数量少于topN，补充其他片段到topN
      const remainingSlots = topN - highScoreChunks.length;
      const otherChunks = sortedChunks
        .filter(chunk => chunk.score < highScoreThreshold)
        .slice(0, remainingSlots);

      const result = [...highScoreChunks, ...otherChunks];

      if (highScoreChunks.length > 0) {
        console.log(`📊 保留 ${highScoreChunks.length} 个高分片段 + ${otherChunks.length} 个其他片段，共 ${result.length} 个`);
      }

      return result;
    }
  }

  /**
   * 使用LLM过滤不相关的代码片段
   * @param userRequest 用户请求
   * @param snippets 待过滤的代码片段
   */
  private async filterIrrelevantSnippets(
    userRequest: string,
    snippets: ScoredChunk[],
  ): Promise<ScoredChunk[]> {
    if (!this.llm || !snippets.length) {
      return snippets;
    }

    // 统计各模块的片段数
    const moduleSnippetCount = new Map<string, number>();
    for (const snippet of snippets) {
      const module = snippet.module || "未知模块";
      moduleSnippetCount.set(module, (moduleSnippetCount.get(module) || 0) + 1);
    }

    try {
      // 构建代码片段描述
      const snippetDescriptions = snippets.map(
        (snippet, index) =>
          `【代码片段 ${index + 1}】
文件: ${snippet.file}
起始行: ${snippet.start_line}
模块: ${snippet.module || "未知"}
评分: ${snippet.score.toFixed(3)}
代码内容:
\`\`\`java
${snippet.code.substring(0, 1000)}${snippet.code.length > 1000 ? "..." : ""}
\`\`\``,
      );

      const userContent = `用户需求分析：
${userRequest}

待过滤的代码片段：
${snippetDescriptions.join("\n\n")}`;

      // 重置之前的结果
      this.toolCallResults.filterResults = undefined;

      // 定义工具
      const tools = [
        {
          type: "function",
          function: {
            name: "submitSnippetFilterResults",
            description: "提交代码片段过滤结果",
            parameters: {
              type: "object",
              properties: {
                evaluations: {
                  type: "array",
                  description: "代码片段过滤评估结果数组",
                  items: {
                    type: "object",
                    properties: {
                      file: {
                        type: "string",
                        description: "文件路径",
                      },
                      start_line: {
                        type: "number",
                        description: "代码片段起始行号",
                      },
                      is_relevant: {
                        type: "boolean",
                        description: "是否相关",
                      },
                      reason: {
                        type: "string",
                        description: "相关性判断理由",
                      },
                    },
                    required: ["file", "start_line", "is_relevant", "reason"],
                  },
                },
              },
              required: ["evaluations"],
            },
          },
        },
      ];

      // 设置工具调用处理函数
      const toolCallHandlers = {
        submitSnippetFilterResults: this.submitSnippetFilterResults,
      };

      // 创建带超时的 AbortController
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => {
        abortController.abort();
      }, 45000); // 45秒超时，比评估方法稍长

      const messages: ChatMessage[] = [
        {
          role: "system",
          content: this.filterSystemPrompt.replace(
            "{user_request}",
            userRequest,
          ),
        },
        { role: "user", content: userContent },
      ];

      const response = await this.llm.chat(messages, abortController.signal, {
        temperature: 0.0,
        maxTokens: 4096,
        // 注意：这里的 tools 和 tool_choice 可能在某些 LLM 实现中不支持
        // 我们将在内容中解析结果
      });

      clearTimeout(timeoutId);

      // 处理LLM响应内容
      const content = response.content;
      if (typeof content === "string") {
        // 直接尝试XML解析，不依赖特定字符串检查
        try {
          const args = this.extractToolCallArgs(
            content,
            "submitSnippetFilterResults",
          );

          if (args.evaluations && Array.isArray(args.evaluations)) {
            this.submitSnippetFilterResults(args.evaluations);
          } else {
            console.warn("⚠️ XML解析成功但缺少 evaluations 数组");
          }
        } catch (extractError) {
          console.error(
            "❌ XML过滤解析失败:",
            extractError instanceof Error
              ? extractError.message
              : String(extractError),
          );
          console.error("📄 LLM原始响应内容:", content.substring(0, 1000));
        }
      } else {
        console.error("❌ LLM响应内容不是字符串格式");
      }

      // 检查是否有工具调用结果
      const filterResults = this.toolCallResults.filterResults;
      let evaluations: SnippetFilterEvaluation[] = [];

      if (filterResults && Array.isArray(filterResults)) {
        evaluations = filterResults as SnippetFilterEvaluation[];
        if (evaluations.length > 0) {
        } else {
          console.warn("⚠️ 过滤工具调用结果为空数组，保留所有代码片段");
          return snippets;
        }
      } else {
        // 如果 XML 解析失败，保留所有代码片段
        console.warn("⚠️ 无法获取 XML 过滤结果，保留所有代码片段");
        return snippets;
      }

      // 检查过滤结果数量是否匹配
      if (evaluations.length !== snippets.length) {
        console.warn(
          `⚠️ 过滤结果数量不匹配: 期望 ${snippets.length} 个，实际获得 ${evaluations.length} 个`,
        );
        console.warn("⚠️ 将按现有结果进行过滤，未匹配的片段将被保留");
      }

      // 应用过滤结果
      const filteredSnippets: ScoredChunk[] = [];
      const moduleFilterStats = new Map<
        string,
        { total: number; kept: number; filtered: number }
      >();

      for (let i = 0; i < snippets.length; i++) {
        const snippet = snippets[i];
        const module = snippet.module || "未知模块";

        // 初始化模块统计
        if (!moduleFilterStats.has(module)) {
          moduleFilterStats.set(module, { total: 0, kept: 0, filtered: 0 });
        }
        const stats = moduleFilterStats.get(module)!;
        stats.total++;

        if (i < evaluations.length) {
          const evaluation = evaluations[i];

          if (evaluation.is_relevant) {
            filteredSnippets.push(snippet);
            stats.kept++;
          } else {
            stats.filtered++;
          }
        } else {
          // 没有对应的评估结果，默认保留
          filteredSnippets.push(snippet);
          stats.kept++;
        }
      }

      // 输出各模块的过滤统计
      return filteredSnippets;
    } catch (error) {
      console.warn(
        "LLM过滤过程出错，保留所有代码片段:",
        error instanceof Error ? error.message : String(error),
      );
      return snippets;
    }
  }

  /**
   * 获取相关代码片段 (对应Python的get_relevant_snippets函数)
   * 为每个模块分别返回topN个代码片段
   * @param moduleFileMap 模块名到文件列表的映射
   * @param userRequest 用户请求
   * @param topN 每个模块返回的代码片段数量
   * @param batchSize 批处理大小
   */
  async getRelevantSnippets(
    moduleFileMap: ModuleFileMap,
    userRequest: string,
    topN: number = 5,
    batchSize: number = 10,
  ): Promise<ScoredChunk[]> {
    if (!Object.keys(moduleFileMap).length || !userRequest) {
      throw new Error("模块文件映射和用户请求必须提供且非空");
    }

    // 获取当前IDE打开的工作空间目录
    const workspaceDirs = await this.ide.getWorkspaceDirs();
    if (!workspaceDirs.length) {
      throw new Error("未找到工作空间目录");
    }

    // 使用第一个工作空间目录作为基础路径
    const basePath = workspaceDirs[0];
    const normalizedBasePath = basePath.startsWith("file://")
      ? localPathOrUriToPath(basePath)
      : basePath;

    const baseUri = this.safePathToUri(normalizedBasePath);

    if (!(await this.ide.fileExists(baseUri))) {
      throw new Error(`工作空间目录 ${normalizedBasePath} 不存在`);
    }

    // 为每个模块并发处理
    const moduleResults: ScoredChunk[] = [];
    const moduleTasks: Promise<ScoredChunk[]>[] = [];

    for (const [moduleName, files] of Object.entries(moduleFileMap)) {
      const moduleTask = this.concurrencyManager.execute(async () => {
        return await this.processModuleChunks(
          moduleName,
          files,
          normalizedBasePath,
          userRequest,
          topN,
          batchSize,
        );
      });
      moduleTasks.push(moduleTask);
    }

    // 等待所有模块处理完成
    const moduleTaskResults = await Promise.allSettled(moduleTasks);

    let successModules = 0;
    let errorModules = 0;
    let totalProvidedChunks = 0;

    // 计算总的提供片段数
    for (const files of Object.values(moduleFileMap)) {
      totalProvidedChunks += files.length; // 这里是文件数，实际片段数会更多
    }

    for (let i = 0; i < moduleTaskResults.length; i++) {
      const result = moduleTaskResults[i];
      const moduleName = Object.keys(moduleFileMap)[i];

      if (result.status === "fulfilled") {
        const moduleChunks = result.value;
        moduleResults.push(...moduleChunks);
        successModules++;
      } else {
        console.error(`❌ 模块 ${moduleName} 处理失败: ${result.reason}`);
        errorModules++;
      }
    }

    // 显示并发管理器统计信息
    const stats = this.concurrencyManager.getStats();
    // 按模块统计过滤前的片段数
    const moduleStats = new Map<string, number>();
    for (const snippet of moduleResults) {
      const module = snippet.module || "未知模块";
      moduleStats.set(module, (moduleStats.get(module) || 0) + 1);
    }

    if (moduleResults.length === 0) {
      console.warn("⚠️ 没有代码片段需要过滤，使用备选方案获取基础代码片段");
      const fallbackSnippets = await this.getFallbackSnippets(
        moduleFileMap,
        userRequest,
        normalizedBasePath,
        topN,
      );
      console.log(`📋 备选方案获取到 ${fallbackSnippets.length} 个代码片段`);
      return fallbackSnippets;
    }

    const filteredResults = await this.filterIrrelevantSnippets(
      userRequest,
      moduleResults,
    );

    // 按模块统计过滤后的片段数
    const filteredModuleStats = new Map<string, number>();
    for (const snippet of filteredResults) {
      const module = snippet.module || "未知模块";
      filteredModuleStats.set(
        module,
        (filteredModuleStats.get(module) || 0) + 1,
      );
    }

    // 如果过滤后没有结果，使用备选方案
    if (filteredResults.length === 0) {
      console.warn("⚠️ 过滤后没有相关代码片段，使用备选方案获取基础代码片段");
      const fallbackSnippets = await this.getFallbackSnippets(
        moduleFileMap,
        userRequest,
        normalizedBasePath,
        Math.min(topN, 5), // 备选方案返回较少的片段
      );
      console.log(`📋 备选方案获取到 ${fallbackSnippets.length} 个代码片段`);
      return fallbackSnippets;
    }

    return filteredResults;
  }

  /**
   * 处理单个模块的代码块
   * @param moduleName 模块名称
   * @param files 文件列表
   * @param basePath 基础路径
   * @param userRequest 用户请求
   * @param topN 返回的代码片段数量
   * @param batchSize 批处理大小
   */
  private async processModuleChunks(
    moduleName: string,
    files: string[],
    basePath: string,
    userRequest: string,
    topN: number,
    batchSize: number,
  ): Promise<ScoredChunk[]> {
    // 收集该模块的所有代码块
    const moduleChunks: CodeChunk[] = [];
    const fileTasks: Promise<CodeChunk[]>[] = [];

    const modulePath = path.join(basePath, moduleName);
    for (const file of files) {
      const filePath = path.join(modulePath, file);
      const fileUri = this.safePathToUri(filePath);

      // 检查文件是否存在
      if (await this.ide.fileExists(fileUri)) {
        fileTasks.push(this.readFileChunks(filePath));
      } else {
        console.warn(`文件 ${filePath} 不存在，跳过`);
      }
    }

    // 等待该模块所有文件的代码块读取完成
    const chunkLists = await Promise.allSettled(fileTasks);
    for (const result of chunkLists) {
      if (result.status === "fulfilled") {
        moduleChunks.push(...result.value);
      } else {
        console.error(`读取文件错误: ${result.reason}`);
      }
    }

    if (!moduleChunks.length) {
      console.warn(`模块 ${moduleName} 未找到有效的代码块`);
      return [];
    }

    // 对该模块的代码块进行批处理评分
    const moduleScores: RelevanceScore[] = [];
    const batchTasks: Promise<{
      batchIndex: number;
      scores: RelevanceScore[];
      error?: Error;
    }>[] = [];

    for (let i = 0; i < moduleChunks.length; i += batchSize) {
      const batchIndex = Math.floor(i / batchSize) + 1;
      const batch = moduleChunks.slice(i, i + batchSize);

      const task = this.concurrencyManager.execute(async () => {
        try {
          const batchScores = await this.evaluateRelevance(userRequest, batch);
          return { batchIndex, scores: batchScores };
        } catch (error) {
          console.error(
            `模块 ${moduleName} 第 ${batchIndex} 批处理失败: ${error instanceof Error ? error.message : String(error)}`,
          );
          // 为失败的批次添加默认分数
          const defaultScores = batch.map((chunk) => ({
            file: chunk.file_path,
            start_line: chunk.start_line,
            score: 0,
          }));
          return { batchIndex, scores: defaultScores, error: error as Error };
        }
      });

      batchTasks.push(task);
    }

    // 等待该模块所有批次完成
    const batchResults = await Promise.allSettled(batchTasks);

    let successBatches = 0;
    let errorBatches = 0;

    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        moduleScores.push(...result.value.scores);
        if (result.value.error) {
          errorBatches++;
        } else {
          successBatches++;
        }
      } else {
        console.error(`模块 ${moduleName} 批次处理完全失败: ${result.reason}`);
        errorBatches++;
      }
    }

    // 智能选择该模块的代码片段 - 保留所有高分片段
    const selectedChunks = this.selectTopSnippetsWithHighScorePreservation(moduleScores, topN);

    // 构建该模块的结果
    const moduleResults: ScoredChunk[] = [];

    for (const chunk of selectedChunks) {
      let matched = false;
      for (const origChunk of moduleChunks) {
        // 使用更宽松的路径匹配逻辑
        if (this.isPathMatch(origChunk.file_path, chunk.file, origChunk.start_line, chunk.start_line)) {
          moduleResults.push({
            file: chunk.file,
            start_line: chunk.start_line,
            score: chunk.score,
            code: origChunk.chunk,
            module: moduleName, // 添加模块信息
          });
          matched = true;
          break;
        }
      }

      if (!matched) {
        console.warn(
          `⚠️ 未找到匹配的原始代码块: ${chunk.file}:${chunk.start_line} (评分: ${chunk.score})`,
        );
        // 输出一些调试信息
        console.warn(
          `   可用的原始代码块路径示例: ${moduleChunks
            .slice(0, 3)
            .map((c) => c.file_path)
            .join(", ")}`,
        );
      }
    }

    return moduleResults;
  }
}
