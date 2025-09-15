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
  // 修改：支持ID匹配
  id?: number; // 添加ID字段用于精确匹配
  file: string;
  start_line: number;
  score: number;
}

// 新增：合并的评分和总结结果
export interface ScoreAndSummary {
  id?: number; // 添加ID字段用于精确匹配
  file: string;
  start_line: number;
  score: number;
  summary: string;
}

export interface ModuleFileMap {
  [moduleName: string]: string[];
}

export interface SnippetFilterEvaluation {
  id?: number; // 添加ID字段用于精确匹配
  file: string;
  start_line: number;
  is_relevant: boolean;
  reason?: string;
}

export interface CodeSummary {
  id?: number; // 添加ID字段用于精确匹配
  file: string;
  start_line: number;
  summary: string;
}

export interface ModuleSummary {
  module: string;
  summary: string;
  chunk_count: number;
}

// Tool 调用结果存储
interface ToolCallResults {
  relevanceScores?: RelevanceScore[];
  filterResults?: SnippetFilterEvaluation[];
  codeSummaries?: CodeSummary[];
  moduleSummaries?: ModuleSummary[];
  scoreAndSummaries?: ScoreAndSummary[]; // 新增：合并的评分和总结结果
}

// 添加：代码块索引映射
interface CodeChunkIndex {
  [id: number]: CodeChunk;
}

/**
 * 智能并发管理器
 */
class ConcurrencyManager {
  private maxConcurrency: number;
  private currentConcurrency = 0;
  private queue: Array<() => Promise<any>> = [];

  constructor(maxConcurrency: number = 4) {
    this.maxConcurrency = maxConcurrency;
  }

  async execute<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await task();
          resolve(result);
        } catch (error) {
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
      // 基础延迟
      await new Promise((resolve) => setTimeout(resolve, 200));
      this.processQueue();
    }
  }
}

export class CodeSnippetAnalyzer {
  protected maxChunkSize: number;
  private systemPrompt: string;
  private filterSystemPrompt: string;
  private summarySystemPrompt: string;
  private moduleSummarySystemPrompt: string;
  private scoreAndSummarySystemPrompt: string; // 新增：合并评分和总结的系统提示词
  private concurrencyManager: ConcurrencyManager;
  private enableSummaries: boolean; // 控制是否启用总结功能
  private toolCallResults: ToolCallResults = {
    relevanceScores: undefined,
    filterResults: undefined,
    codeSummaries: undefined,
    moduleSummaries: undefined,
    scoreAndSummaries: undefined,
  };

  // 添加：代码块索引映射
  private codeChunkIndex: CodeChunkIndex = {};
  private nextChunkId: number = 1;

  // 添加高级检索索引
  private ftsIndex: FullTextSearchCodebaseIndex;
  private lanceDbIndex: LanceDbIndex | null = null;

  // 关键词提取缓存
  private keywordCache = new Map<
    string,
    { keywords: string[]; timestamp: number }
  >();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存

  constructor(
    protected ide: IDE,
    protected llm?: ILLM,
    maxChunkSize: number = 800,
    maxConcurrency: number = 4,
    enableSummaries: boolean = true, // 默认关闭总结功能以节省token
  ) {
    this.maxChunkSize = maxChunkSize;
    this.enableSummaries = enableSummaries;
    this.concurrencyManager = new ConcurrencyManager(maxConcurrency);

    // 设置 XML 格式的提示词
    this.systemPrompt = this.getSystemPrompt();
    this.filterSystemPrompt = this.getFilterSystemPrompt();
    this.summarySystemPrompt = this.getSummarySystemPrompt();
    this.moduleSummarySystemPrompt = this.getModuleSummarySystemPrompt();
    this.scoreAndSummarySystemPrompt = this.getScoreAndSummarySystemPrompt(); // 新增

    // 初始化检索索引
    this.ftsIndex = new FullTextSearchCodebaseIndex();
    this.initLanceDb();

    // 定期清理过期缓存
    setInterval(() => this.cleanExpiredCache(), 60000); // 每分钟清理一次
  }

  /**
   * 清理过期的缓存条目
   */
  private cleanExpiredCache(): void {
    const now = Date.now();
    let cleanedCount = 0;

    const entries = Array.from(this.keywordCache.entries());
    for (const [key, value] of entries) {
      if (now - value.timestamp > this.CACHE_TTL) {
        this.keywordCache.delete(key);
        cleanedCount++;
      }
    }
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
- Files with only import statements: Very low score (0)
- Empty classes or methods without implementation: Very low score (0)

OUTPUT FORMAT:
You MUST respond with ONLY this exact XML format:
<scores>
<score id="chunk_id" value="score_value" />
<score id="chunk_id" value="score_value" />
</scores>

IMPORTANT RULES:
1. Use the ID attribute to identify code chunks
2. Include ALL code snippets in your response
3. No additional text or explanations
4. Ensure valid XML format

Example:
<scores>
<score id="1" value="8" />
<score id="2" value="6" />
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
- Files with only import statements: NOT RELEVANT
- Empty classes or methods without implementation: NOT RELEVANT
- Completely unrelated functionality: NOT RELEVANT

OUTPUT FORMAT:
You MUST respond with ONLY this exact XML format:
<filters>
<filter id="chunk_id" relevant="true_or_false" reason="brief_reason" />
<filter id="chunk_id" relevant="true_or_false" reason="brief_reason" />
</filters>

IMPORTANT RULES:
1. Use the ID attribute to identify code chunks
2. Include ALL code snippets in your response
3. No additional text or explanations
4. Ensure valid XML format

Example:
<filters>
<filter id="1" relevant="true" reason="implements cache functionality" />
<filter id="2" relevant="false" reason="only imports and boilerplate" />
</filters>
        `;
  }

  /**
   * 获取代码总结系统提示词
   */
  private getSummarySystemPrompt(): string {
    return `
You are a senior code analysis expert. Provide concise summaries for code snippets.

TASK: Generate brief, accurate summaries describing what each code snippet does.

SUMMARY REQUIREMENTS:
- Maximum 20 words per summary
- Focus on the main functionality or purpose
- Use technical terms appropriately
- Be precise and specific
- Avoid generic descriptions

OUTPUT FORMAT:
You MUST respond with ONLY this exact XML format:
<summaries>
<summary id="chunk_id" text="brief_description" />
<summary id="chunk_id" text="brief_description" />
</summaries>

IMPORTANT RULES:
1. Use the ID attribute to identify code chunks
2. Include ALL code snippets in your response
3. No additional text or explanations
4. Ensure valid XML format
5. Keep summaries under 20 words

Example:
<summaries>
<summary id="1" text="Implements user authentication with JWT tokens" />
<summary id="2" text="Validates input parameters and throws exceptions" />
</summaries>
        `;
  }

  /**
   * 获取合并评分和总结的系统提示词
   */
  private getScoreAndSummarySystemPrompt(): string {
    return `
You are a senior code analysis expert. Analyze code snippets for relevance to user requirements and provide concise summaries.

TASK: Evaluate each code snippet with a score from 0-10 (10=most relevant) and generate brief, accurate summaries describing what each code snippet does.

SCORING CRITERIA:
- Relevant functionality/methods: High score
- Relevant configuration/constants: High score
- Relevant keywords/variables: Medium score
- Related comments/documentation: Medium score
- Generic code/imports only: Low score
- Files with only import statements: Very low score (0)
- Empty classes or methods without implementation: Very low score (0)

SUMMARY REQUIREMENTS:
- Maximum 20 words per summary
- Focus on the main functionality or purpose
- Use technical terms appropriately
- Be precise and specific
- Avoid generic descriptions

OUTPUT FORMAT:
You MUST respond with ONLY this exact XML format:
<scores>
<score id="chunk_id" value="score_value" />
<score id="chunk_id" value="score_value" />
</scores>
<summaries>
<summary id="chunk_id" text="brief_description" />
<summary id="chunk_id" text="brief_description" />
</summaries>

IMPORTANT RULES:
1. Use the ID attribute to identify code chunks
2. Include ALL code snippets in your response
3. No additional text or explanations
4. Ensure valid XML format

Example:
<scores>
<score id="1" value="8" />
<score id="2" value="6" />
</scores>
<summaries>
<summary id="1" text="Caches data in memory" />
<summary id="2" text="Fetches data from API" />
</summaries>
        `;
  }

  /**
   * 获取模块总结系统提示词
   */
  private getModuleSummarySystemPrompt(): string {
    return `
You are a senior software architect. Provide concise module-level summaries.

TASK: Analyze all code summaries from a module and create a comprehensive module summary.

MODULE SUMMARY REQUIREMENTS:
- Maximum 50 words per module summary
- Describe the overall purpose and functionality of the module
- Highlight key components and their relationships
- Use architectural terminology
- Be precise and comprehensive

OUTPUT FORMAT:
You MUST respond with ONLY this exact XML format:
<module_summaries>
<module_summary name="module_name" text="comprehensive_module_description" chunks="chunk_count" />
</module_summaries>

IMPORTANT RULES:
1. Include the exact module name provided
2. No additional text or explanations
3. Ensure valid XML format
4. Keep summaries under 50 words
5. Include the chunk count

Example:
<module_summaries>
<module_summary name="user-service" text="Handles user authentication, authorization, and profile management with JWT tokens, role-based access control, and database persistence" chunks="15" />
</module_summaries>
        `;
  }

  /**
   * 启用或禁用代码总结功能
   * @param enabled 是否启用总结功能
   */
  public setSummariesEnabled(enabled: boolean): void {
    this.enableSummaries = enabled;
    if (enabled) {
      console.log("✅ 代码总结功能已启用（会消耗额外的token）");
    } else {
      console.log("⚠️ 代码总结功能已禁用（节省token消耗）");
    }
  }

  /**
   * 从 MessageContent 中提取文本内容
   * @param content LLM 响应内容
   * @returns 提取的文本字符串
   */
  private extractTextFromMessageContent(content: any): string {
    if (typeof content === "string") {
      return content.trim();
    }

    if (Array.isArray(content)) {
      return content
        .map((part) => (part.type === "text" ? part.text || "" : ""))
        .join("")
        .trim();
    }

    return "";
  }

  /**
   * LLM 辅助关键词提取和转换（带缓存）
   * @param userRequest 用户请求
   * @returns 转换后的英文技术关键词
   */
  private async extractLLMKeywords(userRequest: string): Promise<string[]> {
    // 生成缓存键（标准化用户请求）
    const cacheKey = userRequest.trim().toLowerCase();

    // 检查缓存
    const cached = this.keywordCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.keywords;
    }

    if (!this.llm) {
      const keywords = this.extractSmartKeywords(userRequest);

      // 缓存结果
      this.keywordCache.set(cacheKey, { keywords, timestamp: Date.now() });

      return keywords;
    }

    try {
      const prompt = `请分析以下用户请求，提取出相关的英文技术关键词，用于搜索Java代码。

用户请求：${userRequest}

请提取：
1. 业务概念对应的英文类名/方法名（如：用户→User, 订单→Order）
2. 技术概念的英文词汇（如：登录→login/authenticate, 验证→validate/verify）
3. Java技术栈相关词汇（如：Service, Controller, Repository, Manager等）

要求：
- 只返回英文单词，用逗号分隔
- 优先返回在Java代码中常见的词汇
- 包含可能的类名、方法名、包名等
- 最多返回10个关键词

示例：
用户请求：查找用户登录验证功能
返回：User,Login,Authentication,Validate,Service,Controller,Auth,Security

请直接返回关键词列表：`;

      // 创建带超时的 AbortController
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => {
        abortController.abort();
      }, 8000); // 减少超时时间到8秒

      const response = await this.llm.chat(
        [{ role: "user", content: prompt }],
        abortController.signal,
        {
          temperature: 0.1,
          maxTokens: 150, // 减少token数量
        },
      );

      clearTimeout(timeoutId);

      // 提取文本内容
      const content = this.extractTextFromMessageContent(response.content);

      const keywords = content
        .split(/[,，\s]+/)
        .map((kw: string) => kw.trim().toLowerCase())
        .filter((kw: string) => kw.length > 1 && /^[a-z]+$/i.test(kw))
        .slice(0, 10);

      // 缓存结果
      this.keywordCache.set(cacheKey, { keywords, timestamp: Date.now() });

      return keywords;
    } catch (error) {
      console.warn("⚠️ LLM关键词提取失败，使用备选方案:", error);
      const keywords = this.extractSmartKeywords(userRequest);

      // 缓存备选结果
      this.keywordCache.set(cacheKey, { keywords, timestamp: Date.now() });

      return keywords;
    }
  }

  /**
   * 智能关键词提取（备选方案，优化版）
   * @param userRequest 用户请求
   * @returns 提取的关键词数组，按重要性排序
   */
  private extractSmartKeywords(userRequest: string): string[] {
    // 优化：使用静态停用词集合，避免重复创建
    const stopWords = this.getStopWords();
    const techKeywords = this.getTechKeywords();

    // 优化：使用更高效的正则表达式
    const allWords: string[] = [];

    // 英文单词提取（优化：一次性提取）
    const englishWords = userRequest.toLowerCase().match(/[a-z]{2,}/g) || []; // 直接过滤长度<2的词
    allWords.push(...englishWords);

    // 中文词汇提取（优化：减少循环次数）
    const chineseMatches = userRequest.match(/[\u4e00-\u9fa5]{2,}/g) || []; // 直接匹配长度>=2的中文
    chineseMatches.forEach((phrase: string) => {
      allWords.push(phrase); // 只保留整个短语，不再分割单字

      // 可选：对于特别长的中文短语，提取关键子串
      if (phrase.length > 4) {
        for (let i = 0; i <= phrase.length - 2; i++) {
          const substr = phrase.substring(i, i + 2);
          if (!stopWords.has(substr)) {
            allWords.push(substr);
          }
        }
      }
    });

    // 优化：使用Map进行权重计算，减少查找次数
    const keywordWeights = new Map<string, number>();

    allWords.forEach((word) => {
      if (stopWords.has(word)) {
        return; // 跳过停用词
      }

      // 计算权重
      let weight = techKeywords.get(word) || 1;

      // 长词给更高权重
      if (word.length > 4) {
        weight += 1;
      }

      keywordWeights.set(word, (keywordWeights.get(word) || 0) + weight);
    });

    // 按权重排序，返回前10个关键词
    const sortedKeywords = Array.from(keywordWeights.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);

    return sortedKeywords;
  }

  /**
   * 获取停用词集合（静态缓存）
   */
  private static stopWordsCache: Set<string> | null = null;

  private getStopWords(): Set<string> {
    if (!CodeSnippetAnalyzer.stopWordsCache) {
      CodeSnippetAnalyzer.stopWordsCache = new Set([
        // 中文停用词（精简版）
        "的",
        "是",
        "在",
        "有",
        "和",
        "与",
        "或",
        "但",
        "如果",
        "那么",
        "这个",
        "那个",
        "查找",
        "寻找",
        "搜索",
        "找到",
        "获取",
        "显示",
        "相关",
        "关于",
        "代码",
        "文件",
        // 英文停用词（精简版）
        "the",
        "a",
        "an",
        "and",
        "or",
        "but",
        "in",
        "on",
        "at",
        "to",
        "for",
        "of",
        "with",
        "by",
        "find",
        "search",
        "get",
        "show",
        "display",
        "related",
        "about",
        "code",
        "file",
        "function",
      ]);
    }
    return CodeSnippetAnalyzer.stopWordsCache;
  }

  /**
   * 获取技术关键词权重映射（静态缓存）
   */
  private static techKeywordsCache: Map<string, number> | null = null;

  private getTechKeywords(): Map<string, number> {
    if (!CodeSnippetAnalyzer.techKeywordsCache) {
      CodeSnippetAnalyzer.techKeywordsCache = new Map([
        // Java相关（高权重）
        ["class", 3],
        ["interface", 3],
        ["method", 3],
        ["function", 3],
        // 架构组件（中权重）
        ["service", 2],
        ["controller", 2],
        ["repository", 2],
        ["entity", 2],
        ["util", 2],
        ["helper", 2],
        ["manager", 2],
        ["handler", 2],
        // 业务关键词（中权重）
        ["user", 2],
        ["login", 2],
        ["auth", 2],
        ["permission", 2],
        ["role", 2],
        ["order", 2],
        ["product", 2],
        ["payment", 2],
        ["account", 2],
        // 操作关键词（中权重）
        ["create", 2],
        ["update", 2],
        ["delete", 2],
        ["query", 2],
        ["save", 2],
        ["validate", 2],
        ["check", 2],
        ["process", 2],
        ["handle", 2],
      ]);
    }
    return CodeSnippetAnalyzer.techKeywordsCache;
  }

  /**
   * 智能预过滤：多层次匹配策略
   * @param codeChunks 代码块数组
   * @param userRequest 用户请求
   * @returns 过滤后的代码块
   */
  private async smartPreFilter(
    codeChunks: CodeChunk[],
    userRequest: string,
  ): Promise<CodeChunk[]> {
    // 优先使用 LLM 辅助关键词提取
    const keywords = await this.extractLLMKeywords(userRequest);

    if (keywords.length === 0) {
      const result = codeChunks.slice(0, Math.min(30, codeChunks.length));
      return result;
    }

    // 优化：预编译正则表达式，避免重复编译
    const keywordPatterns = keywords.map((keyword) => ({
      keyword,
      contentRegex: new RegExp(keyword, "i"),
      pathRegex: new RegExp(keyword, "i"),
      javaPatterns: [
        new RegExp(`class.*${keyword}`, "i"),
        new RegExp(`${keyword}.*class`, "i"),
        new RegExp(`public.*${keyword}`, "i"),
        new RegExp(`private.*${keyword}`, "i"),
        new RegExp(`${keyword}\\s*\\(`, "i"),
        new RegExp(`\\.${keyword}\\s*\\(`, "i"),
      ],
    }));

    // 使用Map存储匹配结果，避免重复计算
    const chunkScores = new Map<string, { chunk: CodeChunk; score: number }>();
    let matchedChunksCount = 0;

    codeChunks.forEach((chunk) => {
      const key = `${chunk.file_path}:${chunk.start_line}`;
      const chunkLower = chunk.chunk.toLowerCase();
      const pathLower = chunk.file_path.toLowerCase();
      let score = 0;

      keywordPatterns.forEach(
        ({ keyword, contentRegex, pathRegex, javaPatterns }) => {
          // 严格内容匹配 (权重: 4)
          if (contentRegex.test(chunkLower)) {
            score += 4;
          }

          // 路径匹配 (权重: 3)
          if (pathRegex.test(pathLower)) {
            score += 3;
          }

          // Java模式匹配 (权重: 2)
          if (javaPatterns.some((pattern) => pattern.test(chunkLower))) {
            score += 2;
          }
        },
      );

      // 模糊匹配：计算匹配的关键词比例
      const matchedKeywords = keywords.filter(
        (keyword) =>
          chunkLower.includes(keyword) || pathLower.includes(keyword),
      ).length;

      const matchRatio = matchedKeywords / keywords.length;
      if (matchRatio >= 0.25) {
        // 至少匹配25%的关键词
        score += Math.floor(matchRatio * 4); // 根据匹配比例给分
      }

      if (score > 0) {
        chunkScores.set(key, { chunk, score });
        matchedChunksCount++;
      }
    });

    // 按分数排序，取前面的结果
    const sortedMatches = Array.from(chunkScores.values())
      .sort((a, b) => b.score - a.score)
      .map((item) => item.chunk);

    // 如果没有匹配结果，返回前30个
    const result =
      sortedMatches.length > 0
        ? sortedMatches
        : codeChunks.slice(0, Math.min(30, codeChunks.length));

    return result;
  }

  /**
   * 获取当前总结功能状态
   */
  public isSummariesEnabled(): boolean {
    return this.enableSummaries;
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
   * 兼容性函数：替代 String.prototype.matchAll
   */
  private matchAllCompat(content: string, pattern: RegExp): RegExpExecArray[] {
    const matches: RegExpExecArray[] = [];
    let match: RegExpExecArray | null;

    // 确保正则表达式有全局标志
    const globalPattern = new RegExp(
      pattern.source,
      pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g",
    );

    while ((match = globalPattern.exec(content)) !== null) {
      matches.push(match);
      // 防止无限循环
      if (!globalPattern.global) break;
    }

    return matches;
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
      // 检查是否使用ID或者文件路径格式
      if (score.id !== undefined) {
        // ID格式验证
        if (typeof score.id !== "number" || typeof score.score !== "number") {
          throw new Error("每个评分对象必须包含 id (number), score (number)");
        }
      } else {
        // 文件路径格式验证
        if (
          !score.file ||
          typeof score.start_line !== "number" ||
          typeof score.score !== "number"
        ) {
          throw new Error(
            "每个评分对象必须包含 file (string), start_line (number), score (number)",
          );
        }
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
      // 检查是否使用ID或者文件路径格式
      if (evaluation.id !== undefined) {
        // ID格式验证
        if (
          typeof evaluation.id !== "number" ||
          typeof evaluation.is_relevant !== "boolean"
        ) {
          throw new Error(
            "每个评估对象必须包含 id (number), is_relevant (boolean)",
          );
        }
      } else {
        // 文件路径格式验证
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
    }

    // 存储结果 - 明确类型赋值
    this.toolCallResults.filterResults =
      evaluations as SnippetFilterEvaluation[];

    return "过滤结果已成功提交";
  };

  /**
   * Tool: 提交代码总结结果
   */
  private submitCodeSummaries = (summaries: CodeSummary[]): string => {
    // 验证输入
    if (!Array.isArray(summaries)) {
      throw new Error("summaries 必须是数组");
    }

    for (const summary of summaries) {
      // 检查是否使用ID或者文件路径格式
      if (summary.id !== undefined) {
        // ID格式验证
        if (typeof summary.id !== "number" || !summary.summary) {
          throw new Error("每个总结对象必须包含 id (number), summary (string)");
        }
      } else {
        // 文件路径格式验证
        if (
          !summary.file ||
          typeof summary.start_line !== "number" ||
          !summary.summary
        ) {
          throw new Error(
            "每个总结对象必须包含 file (string), start_line (number), summary (string)",
          );
        }
      }
    }

    // 存储结果
    this.toolCallResults.codeSummaries = summaries as CodeSummary[];

    return "代码总结结果已成功提交";
  };

  /**
   * Tool: 提交模块总结结果
   */
  private submitModuleSummaries = (summaries: ModuleSummary[]): string => {
    // 验证输入
    if (!Array.isArray(summaries)) {
      throw new Error("summaries 必须是数组");
    }

    for (const summary of summaries) {
      if (
        !summary.module ||
        !summary.summary ||
        typeof summary.chunk_count !== "number"
      ) {
        throw new Error(
          "每个模块总结对象必须包含 module (string), summary (string), chunk_count (number)",
        );
      }
    }

    // 存储结果
    this.toolCallResults.moduleSummaries = summaries as ModuleSummary[];

    return "模块总结结果已成功提交";
  };

  /**
   * Tool: 提交合并的评分和总结结果
   */
  private submitScoreAndSummaries = (items: ScoreAndSummary[]): string => {
    // 验证输入
    if (!Array.isArray(items)) {
      throw new Error("items 必须是数组");
    }

    for (const item of items) {
      // 检查是否使用ID或者文件路径格式
      if (item.id !== undefined) {
        // ID格式验证
        if (
          typeof item.id !== "number" ||
          typeof item.score !== "number" ||
          !item.summary
        ) {
          throw new Error(
            "每个项目必须包含 id (number), score (number), summary (string)",
          );
        }
      } else {
        // 文件路径格式验证
        if (
          !item.file ||
          typeof item.start_line !== "number" ||
          typeof item.score !== "number" ||
          !item.summary
        ) {
          throw new Error(
            "每个项目必须包含 file (string), start_line (number), score (number), summary (string)",
          );
        }
      }

      if (item.score < 0 || item.score > 10) {
        throw new Error("评分必须在 0-10 之间");
      }
    }

    // 存储结果
    this.toolCallResults.scoreAndSummaries = items as ScoreAndSummary[];

    return "合并评分和总结结果已成功提交";
    // 存储结果
    this.toolCallResults.scoreAndSummaries = items as ScoreAndSummary[];

    return "合并评分和总结结果已成功提交";
  };

  /**
   * 解析 XML 格式的评分结果
   */
  private parseXmlScores(content: string): RelevanceScore[] {
    const scores: RelevanceScore[] = [];

    // 多种 XML 格式模式
    const patterns = [
      // ID格式 (新格式) - 匹配chunk_数字格式的ID
      /<score[^>]*?id\s*=\s*["']?chunk_(\d+)["']?[^>]*?value\s*=\s*["']?([\d.]+)["']?[^>]*?\/>/gi,
      /<score[^>]*?id\s*=\s*["']?(\d+)["']?[^>]*?value\s*=\s*["']?([\d.]+)["']?[^>]*?\/>/gi,

      // 自闭合标签，任意属性顺序 (旧格式)
      /<score[^>]*?file\s*=\s*["']([^"']*?)["'][^>]*?line\s*=\s*["']?(\d+)["']?[^>]*?value\s*=\s*["']?([\d.]+)["']?[^>]*?\/>/gi,
      /<score[^>]*?line\s*=\s*["']?(\d+)["']?[^>]*?file\s*=\s*["']([^"']*?)["'][^>]*?value\s*=\s*["']?([\d.]+)["']?[^>]*?\/>/gi,
      /<score[^>]*?value\s*=\s*["']?([\d.]+)["']?[^>]*?file\s*=\s*["']([^"']*?)["'][^>]*?line\s*=\s*["']?(\d+)["']?[^>]*?\/>/gi,

      // 开闭标签格式 (旧格式)
      /<score[^>]*?file\s*=\s*["']([^"']*?)["'][^>]*?line\s*=\s*["']?(\d+)["']?[^>]*?value\s*=\s*["']?([\d.]+)["']?[^>]*?>\s*<\/score>/gi,

      // 简化格式（只有必需属性）(旧格式)
      /<score[^>]*?file\s*=\s*["']([^"']*?)["'][^>]*?line\s*=\s*["']?(\d+)["']?[^>]*?value\s*=\s*["']?([\d.]+)["']?[^>]*?\/?>/gi,
    ];

    // 尝试每种模式
    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];
      const matches = this.matchAllCompat(content, pattern);

      for (const match of matches) {
        // 检查是否是ID格式
        if (
          pattern.source.includes("id\\s*=\\s*") &&
          (pattern.source.includes("chunk_") || i === 1)
        ) {
          // ID格式
          const idStr = match[1];
          // 处理chunk_数字格式的ID
          const id = pattern.source.includes("chunk_")
            ? parseInt(idStr)
            : parseInt(idStr);
          const score = parseFloat(match[2]);
          if (!isNaN(id) && !isNaN(score)) {
            scores.push({
              id: id,
              file: "", // 通过ID查找
              start_line: 0, // 通过ID查找
              score: Math.max(0, Math.min(10, score)),
            });
          }
        } else if (!pattern.source.includes("id\\s*=\\s*")) {
          // 旧的路径格式
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

      // 如果找到了结果，就不再尝试其他模式
      if (scores.length > 0) {
        break;
      }
    }

    // 如果没有找到标准格式，尝试更宽松的解析
    if (scores.length === 0) {
      const loosePattern = /<score[^>]*>/gi;
      const scoreElements = this.matchAllCompat(content, loosePattern);

      for (const element of scoreElements) {
        const scoreTag = element[0];

        // 尝试提取ID (包括chunk_格式)
        const idMatch =
          scoreTag.match(/id\s*=\s*["']?chunk_(\d+)["']?/i) ||
          scoreTag.match(/id\s*=\s*["']?(\d+)["']?/i);
        if (idMatch) {
          const id = parseInt(idMatch[1]);
          const valueMatch = scoreTag.match(/value\s*=\s*["']?([\d.]+)["']?/i);

          if (valueMatch) {
            const score = parseFloat(valueMatch[1]);

            if (!isNaN(id) && !isNaN(score)) {
              scores.push({
                id: id,
                file: "", // 通过ID查找
                start_line: 0, // 通过ID查找
                score: Math.max(0, Math.min(10, score)),
              });
            }
          }
        } else {
          // 提取属性（旧格式）
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
    }
    return scores;
  }

  /**
   * 解析 XML 格式的总结结果
   */
  private parseXmlSummaries(content: string): CodeSummary[] {
    const summaries: CodeSummary[] = [];

    // 多种 XML 格式模式
    const patterns = [
      // ID格式 (新格式) - 支持chunk_数字格式
      /<summary[^>]*?id\s*=\s*["'](?:chunk_)?(\d+)["'][^>]*?text\s*=\s*["']((?:[^"']|\\')*)["'][^>]*?\/>/gi,
      /<summary[^>]*?id\s*=\s*["'](?:chunk_)?(\d+)["'][^>]*?text\s*=\s*["']([^"']*)["'][^>]*?\/>/gi,

      // 自闭合标签，任意属性顺序 (旧格式)
      /<summary[^>]*?file\s*=\s*["']([^"']*?)["'][^>]*?line\s*=\s*["']?(\d+)["']?[^>]*?text\s*=\s*["']((?:[^"']|\\')*)["'][^>]*?\/>/gi,
      /<summary[^>]*?file\s*=\s*["']([^"']*?)["'][^>]*?line\s*=\s*["']?(\d+)["']?[^>]*?text\s*=\s*["']([^"']*)["'][^>]*?\/>/gi,
      /<summary[^>]*?line\s*=\s*["']?(\d+)["']?[^>]*?file\s*=\s*["']([^"']*?)["'][^>]*?text\s*=\s*["']((?:[^"']|\\')*)["'][^>]*?\/>/gi,
      /<summary[^>]*?line\s*=\s*["']?(\d+)["']?[^>]*?file\s*=\s*["']([^"']*?)["'][^>]*?text\s*=\s*["']([^"']*)["'][^>]*?\/>/gi,
      /<summary[^>]*?text\s*=\s*["']((?:[^"']|\\')*)["'][^>]*?file\s*=\s*["']([^"']*?)["'][^>]*?line\s*=\s*["']?(\d+)["']?[^>]*?\/>/gi,
      /<summary[^>]*?text\s*=\s*["']([^"']*)["'][^>]*?file\s*=\s*["']([^"']*?)["'][^>]*?line\s*=\s*["']?(\d+)["']?[^>]*?\/>/gi,

      // 开闭标签格式 (旧格式)
      /<summary[^>]*?file\s*=\s*["']([^"']*?)["'][^>]*?line\s*=\s*["']?(\d+)["']?[^>]*?text\s*=\s*["']((?:[^"']|\\')*)["'][^>]*?>\s*<\/summary>/gi,
      /<summary[^>]*?file\s*=\s*["']([^"']*?)["'][^>]*?line\s*=\s*["']?(\d+)["']?[^>]*?text\s*=\s*["']([^"']*)["'][^>]*?>\s*<\/summary>/gi,

      // 简化格式（只有必需属性）(旧格式)
      /<summary[^>]*?file\s*=\s*["']([^"']*?)["'][^>]*?line\s*=\s*["']?(\d+)["']?[^>]*?text\s*=\s*["']((?:[^"']|\\')*)["'][^>]*?\/?>/gi,
      /<summary[^>]*?file\s*=\s*["']([^"']*?)["'][^>]*?line\s*=\s*["']?(\d+)["']?[^>]*?text\s*=\s*["']([^"']*)["'][^>]*?\/?>/gi,
    ];

    // 尝试每种模式
    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];
      const matches = this.matchAllCompat(content, pattern);

      for (let j = 0; j < matches.length; j++) {
        const match = matches[j];
        // 检查是否是ID格式
        if (pattern.source.includes("id\\s*=\\s*")) {
          // ID格式
          const id = parseInt(match[1]);
          const summary = match[2];

          if (!isNaN(id) && summary) {
            summaries.push({
              id: id,
              file: "", // 通过ID查找
              start_line: 0, // 通过ID查找
              summary: summary.trim(),
            });
          }
        } else {
          // 旧的路径格式
          let file: string, startLine: number, summary: string;

          // 根据匹配组的顺序提取数据
          if (pattern.source.includes("file.*?line.*?text")) {
            file = match[1];
            startLine = parseInt(match[2]);
            summary = match[3];
          } else if (pattern.source.includes("line.*?file.*?text")) {
            startLine = parseInt(match[1]);
            file = match[2];
            summary = match[3];
          } else if (pattern.source.includes("text.*?file.*?line")) {
            summary = match[1];
            file = match[2];
            startLine = parseInt(match[3]);
          } else {
            // 默认 file, line, text 顺序
            file = match[1];
            startLine = parseInt(match[2]);
            summary = match[3];
          }

          // 标准化文件路径
          file = file.replace(/\\/g, "/");

          // 验证数据
          if (file && file.includes(".") && !isNaN(startLine) && summary) {
            summaries.push({
              file: file,
              start_line: startLine,
              summary: summary.trim(),
            });
          }
        }
      }

      // 如果找到了结果，就不再尝试其他模式
      if (summaries.length > 0) {
        break;
      }
    }

    // 如果没有找到标准格式，尝试更宽松的解析
    if (summaries.length === 0) {
      const loosePattern =
        /<summary\s+((?:[^>]|\\\>)*?)text\s*=\s*["']((?:[^"']|\\')*)["']((?:[^>]|\\\>)*)\/>/gi;
      const summaryElements = this.matchAllCompat(content, loosePattern);

      for (const match of summaryElements) {
        const attributes = match[1] + match[3]; // 合并前后属性
        const text = match[2];

        // 尝试提取ID或文件路径和行号
        // 支持chunk_数字格式的ID
        const idMatch = attributes.match(/id\s*=\s*["'](?:chunk_)?(\d+)["']/i);
        const fileMatch = attributes.match(/file\s*=\s*["']([^"']*)["']/i);
        const lineMatch = attributes.match(/line\s*=\s*["']?(\d+)["']?/i);

        if (idMatch) {
          const id = parseInt(idMatch[1]);
          if (!isNaN(id)) {
            summaries.push({
              id: id,
              file: "",
              start_line: 0,
              summary: text.trim(),
            });
          }
        } else if (fileMatch && lineMatch) {
          const file = fileMatch[1].replace(/\\/g, "/");
          const startLine = parseInt(lineMatch[1]);
          if (file.includes(".") && !isNaN(startLine)) {
            summaries.push({
              file: file,
              start_line: startLine,
              summary: text.trim(),
            });
          }
        }
      }
    }

    return summaries;
  }
  /**
   * 解析 XML 格式的过滤结果
   */
  private parseXmlFilter(content: string): SnippetFilterEvaluation[] {
    const evaluations: SnippetFilterEvaluation[] = [];
    // 多种 XML 格式模式
    const patterns = [
      // ID格式 (新格式) - 匹配chunk_数字格式的ID
      /<filter[^>]*?id\s*=\s*["']?chunk_(\d+)["']?[^>]*?relevant\s*=\s*["']?(true|false)["']?[^>]*?reason\s*=\s*["']([^"']*?)["'][^>]*?\/>/gi,
      /<filter[^>]*?id\s*=\s*["']?chunk_(\d+)["']?[^>]*?reason\s*=\s*["']([^"']*?)["'][^>]*?relevant\s*=\s*["']?(true|false)["']?[^>]*?\/>/gi,

      // ID格式 (新格式) - 匹配纯数字ID
      /<filter[^>]*?id\s*=\s*["']?(\d+)["']?[^>]*?relevant\s*=\s*["']?(true|false)["']?[^>]*?reason\s*=\s*["']([^"']*?)["'][^>]*?\/>/gi,
      /<filter[^>]*?id\s*=\s*["']?(\d+)["']?[^>]*?reason\s*=\s*["']([^"']*?)["'][^>]*?relevant\s*=\s*["']?(true|false)["']?[^>]*?\/>/gi,

      // file, line, reason, relevant 顺序（LLM 实际输出的顺序）(旧格式)
      /<filter[^>]*?file\s*=\s*["']([^"']*?)["'][^>]*?line\s*=\s*["']?(\d+)["']?[^>]*?reason\s*=\s*["']([^"']*?)["'][^>]*?relevant\s*=\s*["']?(true|false)["']?[^>]*?\/>/gi,

      // file, line, relevant, reason 顺序（标准顺序）(旧格式)
      /<filter[^>]*?file\s*=\s*["']([^"']*?)["'][^>]*?line\s*=\s*["']?(\d+)["']?[^>]*?relevant\s*=\s*["']?(true|false)["']?[^>]*?reason\s*=\s*["']([^"']*?)["'][^>]*?\/>/gi,

      // 开闭标签格式 - file, line, reason, relevant (旧格式)
      /<filter[^>]*?file\s*=\s*["']([^"']*?)["'][^>]*?line\s*=\s*["']?(\d+)["']?[^>]*?reason\s*=\s*["']([^"']*?)["'][^>]*?relevant\s*=\s*["']?(true|false)["']?[^>]*?>\s*<\/filter>/gi,

      // 开闭标签格式 - file, line, relevant, reason (旧格式)
      /<filter[^>]*?file\s*=\s*["']([^"']*?)["'][^>]*?line\s*=\s*["']?(\d+)["']?[^>]*?relevant\s*=\s*["']?(true|false)["']?[^>]*?reason\s*=\s*["']([^"']*?)["'][^>]*?>\s*<\/filter>/gi,
    ];

    // 尝试每种模式
    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];
      const matches = this.matchAllCompat(content, pattern);

      for (const match of matches) {
        // 检查是否是ID格式
        if (pattern.source.includes("id\\s*=\\s*")) {
          // ID格式
          const idStr = match[1];
          const id = parseInt(idStr);
          let isRelevant: boolean, reason: string;

          // 根据模式索引确定参数顺序
          if (i === 0 || i === 2) {
            // id, relevant, reason 顺序
            isRelevant = match[2].toLowerCase() === "true";
            reason = match[3] || "无理由";
          } else {
            // id, reason, relevant 顺序
            reason = match[2] || "无理由";
            isRelevant = match[3].toLowerCase() === "true";
          }

          if (!isNaN(id)) {
            evaluations.push({
              id: id,
              file: "", // 通过ID查找
              start_line: 0, // 通过ID查找
              is_relevant: isRelevant,
              reason: reason,
            });
          }
        } else {
          // 旧的路径格式
          let file: string,
            startLine: number,
            isRelevant: boolean,
            reason: string;

          // 根据模式索引确定参数顺序
          if (i === 4 || i === 6) {
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
            console.warn(
              `⚠️ 跳过无效的XML过滤: file=${file}, line=${startLine}`,
            );
          }
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
      const filterElements = this.matchAllCompat(content, loosePattern);

      for (const element of filterElements) {
        const filterTag = element[0];

        // 尝试提取ID (包括chunk_格式)
        const idMatch =
          filterTag.match(/id\s*=\s*["']?chunk_(\d+)["']?/i) ||
          filterTag.match(/id\s*=\s*["']?(\d+)["']?/i);
        if (idMatch) {
          const id = parseInt(idMatch[1]);
          const relevantMatch = filterTag.match(
            /relevant\s*=\s*["']?(true|false)["']?/i,
          );
          const reasonMatch = filterTag.match(
            /reason\s*=\s*["']([^"']*?)["']/i,
          );

          if (relevantMatch) {
            const isRelevant = relevantMatch[1].toLowerCase() === "true";
            const reason = reasonMatch ? reasonMatch[1] : "无理由";

            if (!isNaN(id)) {
              evaluations.push({
                id: id,
                file: "", // 通过ID查找
                start_line: 0, // 通过ID查找
                is_relevant: isRelevant,
                reason: reason,
              });
            }
          }
        } else {
          // 提取属性（旧格式）
          const fileMatch = filterTag.match(/file\s*=\s*["']([^"']*?)["']/i);
          const lineMatch = filterTag.match(/line\s*=\s*["']?(\d+)["']?/i);
          const relevantMatch = filterTag.match(
            /relevant\s*=\s*["']?(true|false)["']?/i,
          );
          const reasonMatch = filterTag.match(
            /reason\s*=\s*["']([^"']*?)["']/i,
          );

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
    }

    if (evaluations.length === 0) {
      console.error("❌ XML过滤解析失败，未找到任何有效的filter标签");
      console.error("📄 完整响应内容:", content);
    }
    return evaluations;
  }

  /**
   * 解析 XML 格式的模块总结结果
   */
  private parseXmlModuleSummaries(content: string): ModuleSummary[] {
    const summaries: ModuleSummary[] = [];

    // 多种 XML 模块总结格式模式
    const patterns = [
      // 自闭合标签，任意属性顺序 - 支持包含特殊字符的文本
      /<module_summary[^>]*?name\s*=\s*["']([^"']*?)["'][^>]*?text\s*=\s*["']((?:[^"']|\\')*)["'][^>]*?chunks\s*=\s*["']?(\d+)["']?[^>]*?\/>/gi,
      /<module_summary[^>]*?name\s*=\s*["']([^"']*?)["'][^>]*?text\s*=\s*["']([^"']*)["'][^>]*?chunks\s*=\s*["']?(\d+)["']?[^>]*?\/>/gi,
      /<module_summary[^>]*?text\s*=\s*["']((?:[^"']|\\')*)["'][^>]*?name\s*=\s*["']([^"']*?)["'][^>]*?chunks\s*=\s*["']?(\d+)["']?[^>]*?\/>/gi,
      /<module_summary[^>]*?text\s*=\s*["']([^"']*)["'][^>]*?name\s*=\s*["']([^"']*?)["'][^>]*?chunks\s*=\s*["']?(\d+)["']?[^>]*?\/>/gi,
      /<module_summary[^>]*?chunks\s*=\s*["']?(\d+)["']?[^>]*?name\s*=\s*["']([^"']*?)["'][^>]*?text\s*=\s*["']((?:[^"']|\\')*)["'][^>]*?\/>/gi,
      /<module_summary[^>]*?chunks\s*=\s*["']?(\d+)["']?[^>]*?name\s*=\s*["']([^"']*?)["'][^>]*?text\s*=\s*["']([^"']*)["'][^>]*?\/>/gi,

      // 开闭标签格式 - 支持包含特殊字符的文本
      /<module_summary[^>]*?name\s*=\s*["']([^"']*?)["'][^>]*?text\s*=\s*["']((?:[^"']|\\')*)["'][^>]*?chunks\s*=\s*["']?(\d+)["']?[^>]*?>\s*<\/module_summary>/gi,
      /<module_summary[^>]*?name\s*=\s*["']([^"']*?)["'][^>]*?text\s*=\s*["']([^"']*)["'][^>]*?chunks\s*=\s*["']?(\d+)["']?[^>]*?>\s*<\/module_summary>/gi,
    ];

    // 尝试每种模式
    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];
      const matches = this.matchAllCompat(content, pattern);
      for (let j = 0; j < matches.length; j++) {
        const match = matches[j];

        let module: string, summary: string, chunkCount: number;

        // 根据匹配组的顺序提取数据
        if (pattern.source.includes("name.*?text.*?chunks")) {
          // name, text, chunks 顺序
          module = match[1];
          summary = match[2];
          chunkCount = parseInt(match[3]);
        } else if (pattern.source.includes("text.*?name.*?chunks")) {
          // text, name, chunks 顺序
          summary = match[1];
          module = match[2];
          chunkCount = parseInt(match[3]);
        } else if (pattern.source.includes("chunks.*?name.*?text")) {
          // chunks, name, text 顺序
          chunkCount = parseInt(match[1]);
          module = match[2];
          summary = match[3];
        } else {
          // 默认 name, text, chunks 顺序
          module = match[1];
          summary = match[2];
          chunkCount = parseInt(match[3]);
        }

        // 验证数据
        if (module && summary && !isNaN(chunkCount)) {
          summaries.push({
            module: module.trim(),
            summary: summary.trim(),
            chunk_count: chunkCount,
          });
        }
      }

      // 如果找到了结果，就不再尝试其他模式
      if (summaries.length > 0) {
        break;
      }
    }

    // 如果没有找到标准格式，尝试更宽松的解析
    if (summaries.length === 0) {
      const loosePattern =
        /<module_summary\s+((?:[^>]|\\\>)*?)text\s*=\s*["']((?:[^"']|\\')*)["']((?:[^>]|\\\>)*)\/>/gi;
      const moduleElements = this.matchAllCompat(content, loosePattern);

      for (const match of moduleElements) {
        const attributes = match[1] + match[3]; // 合并前后属性
        const text = match[2];

        // 尝试提取name和chunks
        const nameMatch = attributes.match(/name\s*=\s*["']([^"']*)["']/i);
        const chunksMatch = attributes.match(/chunks\s*=\s*["']?(\d+)["']?/i);

        if (nameMatch && chunksMatch) {
          const module = nameMatch[1];
          const chunkCount = parseInt(chunksMatch[1]);
          if (!isNaN(chunkCount)) {
            summaries.push({
              module: module.trim(),
              summary: text.trim(),
              chunk_count: chunkCount,
            });
          }
        }
      }
    }

    return summaries;
  }

  /**
   * 解析 XML 格式的合并评分和总结结果
   */
  private parseXmlScoreAndSummaries(content: string): ScoreAndSummary[] {
    const results: ScoreAndSummary[] = [];

    // 多种 XML 格式模式
    const patterns = [
      // ID格式 (新格式)
      /<item[^>]*?id\s*=\s*["']?(\d+)["']?[^>]*?score\s*=\s*["']?([\d.]+)["']?[^>]*?summary\s*=\s*["']([^"']*?)["'][^>]*?\/>/gi,
      /<item[^>]*?id\s*=\s*["']?(\d+)["']?[^>]*?summary\s*=\s*["']([^"']*?)["'][^>]*?score\s*=\s*["']?([\d.]+)["']?[^>]*?\/>/gi,

      // 自闭合标签，任意属性顺序 (旧格式)
      /<item[^>]*?file\s*=\s*["']([^"']*?)["'][^>]*?line\s*=\s*["']?(\d+)["']?[^>]*?score\s*=\s*["']?([\d.]+)["']?[^>]*?summary\s*=\s*["']([^"']*?)["'][^>]*?\/>/gi,
      /<item[^>]*?line\s*=\s*["']?(\d+)["']?[^>]*?file\s*=\s*["']([^"']*?)["'][^>]*?score\s*=\s*["']?([\d.]+)["']?[^>]*?summary\s*=\s*["']([^"']*?)["'][^>]*?\/>/gi,
      /<item[^>]*?score\s*=\s*["']?([\d.]+)["']?[^>]*?file\s*=\s*["']([^"']*?)["'][^>]*?line\s*=\s*["']?(\d+)["']?[^>]*?summary\s*=\s*["']([^"']*?)["'][^>]*?\/>/gi,
      /<item[^>]*?summary\s*=\s*["']([^"']*?)["'][^>]*?file\s*=\s*["']([^"']*?)["'][^>]*?line\s*=\s*["']?(\d+)["']?[^>]*?score\s*=\s*["']?([\d.]+)["']?[^>]*?\/>/gi,

      // 开闭标签格式 (旧格式)
      /<item[^>]*?file\s*=\s*["']([^"']*?)["'][^>]*?line\s*=\s*["']?(\d+)["']?[^>]*?score\s*=\s*["']?([\d.]+)["']?[^>]*?summary\s*=\s*["']([^"']*?)["'][^>]*?>\s*<\/item>/gi,
    ];

    // 尝试每种模式
    for (const pattern of patterns) {
      const matches = this.matchAllCompat(content, pattern);

      for (const match of matches) {
        // 检查是否是ID格式
        if (pattern.source.includes("id\\s*=\\s*")) {
          // ID格式
          const id = parseInt(match[1]);
          let score: number, summary: string;

          // 根据匹配组的顺序提取数据
          if (pattern.source.includes("id.*?score.*?summary")) {
            // id, score, summary 顺序
            score = parseFloat(match[2]);
            summary = match[3];
          } else {
            // id, summary, score 顺序
            summary = match[2];
            score = parseFloat(match[3]);
          }

          // 验证数据
          if (!isNaN(id) && !isNaN(score) && summary) {
            results.push({
              id: id,
              file: "", // 通过ID查找
              start_line: 0, // 通过ID查找
              score: score,
              summary: summary,
            });
          }
        } else {
          // 旧格式
          const file = match[1].replace(/\\/g, "/");
          const startLine = parseInt(match[2]);
          let score: number, summary: string;

          // 根据匹配组的顺序提取数据
          if (pattern.source.includes("file.*?line.*?score.*?summary")) {
            // file, line, score, summary 顺序
            score = parseFloat(match[3]);
            summary = match[4];
          } else if (pattern.source.includes("line.*?file.*?score.*?summary")) {
            // line, file, score, summary 顺序
            score = parseFloat(match[3]);
            summary = match[4];
          } else if (pattern.source.includes("score.*?file.*?line.*?summary")) {
            // score, file, line, summary 顺序
            score = parseFloat(match[1]);
            summary = match[4];
          } else if (pattern.source.includes("summary.*?file.*?line.*?score")) {
            // summary, file, line, score 顺序
            summary = match[1];
            score = parseFloat(match[4]);
          } else {
            // 默认 file, line, score, summary 顺序
            score = parseFloat(match[3]);
            summary = match[4];
          }

          // 验证数据
          if (
            file &&
            file.includes(".") &&
            !isNaN(startLine) &&
            !isNaN(score) &&
            summary
          ) {
            results.push({
              id: 0,
              file: file,
              start_line: startLine,
              score: score,
              summary: summary,
            });
          }
        }
      }
    }

    if (results.length === 0) {
      console.error("❌ XML评分和总结解析失败，未找到任何有效的item标签");
      console.error("📄 完整响应内容:", content);
    }
    return results;
  }

  /**
   * 从 LLM 响应中提取 XML 格式的参数
   */
  private extractToolCallArgs(content: string, functionName: string): any {
    // 添加日志输出LLM返回的具体内容

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
      } else if (functionName === "submitCodeSummaries") {
        const summaries = this.parseXmlSummaries(content);
        if (summaries.length > 0) {
          return { summaries };
        } else {
          console.warn(`⚠️ 代码总结XML解析返回空结果`);
        }
      } else if (functionName === "submitModuleSummaries") {
        const summaries = this.parseXmlModuleSummaries(content);
        if (summaries.length > 0) {
          return { summaries };
        } else {
          console.warn(`⚠️ 模块总结XML解析返回空结果`);
        }
      } else if (functionName === "submitScoreAndSummaries") {
        const items = this.parseXmlScoreAndSummaries(content);
        if (items.length > 0) {
          return { items };
        } else {
          console.warn(`⚠️ 合并评分和总结XML解析返回空结果`);
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

        // 检查是否需要分割代码块
        // 条件1：达到最大字符数且不在代码块内
        // 条件2：强制分割（即使在代码块内）- 当大小超过两倍maxChunkSize时
        const shouldSplit =
          (chunkText.length >= this.maxChunkSize && !inBlock) ||
          chunkText.length >= this.maxChunkSize * 2;

        if (shouldSplit) {
          chunks.push({
            file_path: filePath,
            start_line: startLine,
            chunk: chunkText,
          });
          startLine = currentLine + 1;
          currentChunk = [];
          braceCount = 0; // 重置大括号计数
          inBlock = false; // 重置代码块状态
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

    // 使用智能预过滤策略
    const chunksToAnalyze = await this.smartPreFilter(codeChunks, userRequest);

    // 为代码块分配ID并建立索引
    const chunkDescriptions = chunksToAnalyze.map((chunk) => {
      // 为每个代码块分配唯一ID并存储在索引中
      const id = this.nextChunkId++;
      this.codeChunkIndex[id] = chunk;

      return `【Code Chunk ${id}】File: ${chunk.file_path}\nStart Line: ${chunk.start_line}\nContent:\n\`\`\`java\n${chunk.chunk.substring(0, 1000)}${chunk.chunk.length > 1000 ? "..." : ""}\n\`\`\``;
    });

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
                      id: {
                        type: "number",
                        description: "代码块ID",
                      },
                      score: {
                        type: "number",
                        description: "相关性评分 (0-10)",
                      },
                    },
                    required: ["id", "score"],
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
          return chunksToAnalyze.map((chunk, index) => {
            // 查找chunk对应的ID
            const id = Object.keys(this.codeChunkIndex).find((key) => {
              const storedChunk = this.codeChunkIndex[parseInt(key)];
              return (
                storedChunk.file_path === chunk.file_path &&
                storedChunk.start_line === chunk.start_line
              );
            });

            return {
              id: id ? parseInt(id) : undefined,
              file: chunk.file_path,
              start_line: chunk.start_line,
              score: 5, // 默认中等评分
            };
          });
        }
      } else {
        // 如果 XML 解析失败，返回默认评分
        console.warn("无法获取 XML 评分结果，返回默认评分");
        return chunksToAnalyze.map((chunk, index) => {
          // 查找chunk对应的ID
          const id = Object.keys(this.codeChunkIndex).find((key) => {
            const storedChunk = this.codeChunkIndex[parseInt(key)];
            return (
              storedChunk.file_path === chunk.file_path &&
              storedChunk.start_line === chunk.start_line
            );
          });

          return {
            id: id ? parseInt(id) : undefined,
            file: chunk.file_path,
            start_line: chunk.start_line,
            score: 5, // 默认中等评分
          };
        });
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
      return chunksToAnalyze.map((chunk) => {
        // 查找chunk对应的ID
        const id = Object.keys(this.codeChunkIndex).find((key) => {
          const storedChunk = this.codeChunkIndex[parseInt(key)];
          return (
            storedChunk.file_path === chunk.file_path &&
            storedChunk.start_line === chunk.start_line
          );
        });

        return {
          id: id ? parseInt(id) : undefined,
          file: chunk.file_path,
          start_line: chunk.start_line,
          score: 0,
        };
      });
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
    const workspaceDirs = await this.ide.getWorkspaceDirs();
    const tags: BranchAndDir[] = workspaceDirs.map((dir) => ({
      directory: dir,
      branch: "main", // 默认分支
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
      const ftsResults = this.convertChunksToScoredChunks(
        ftsChunks,
        "FTS",
        0.8,
      );
      allResults.push(...ftsResults);
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
          undefined,
        );
        const embeddingResults = this.convertChunksToScoredChunks(
          embeddingChunks,
          "Embeddings",
          0.9,
        );
        allResults.push(...embeddingResults);
      } catch (error) {
        console.warn("向量检索失败:", error);
      }
    }

    // 策略3: 最近编辑的文件
    try {
      const recentChunks = await this.retrieveRecentlyEditedFiles(recentN);
      const recentResults = this.convertChunksToScoredChunks(
        recentChunks,
        "Recent",
        0.6,
      );
      allResults.push(...recentResults);
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
          Math.max(keywordN, topN - allResults.length),
        );
        allResults.push(...keywordResults);
      } catch (error) {
        console.warn("关键词检索失败:", error);
      }
    }

    // 去重并智能选择
    const deduplicatedResults = this.deduplicateScoredChunks(allResults);
    const selectedResults = this.selectTopScoredChunksWithHighScorePreservation(
      deduplicatedResults,
      topN,
    );

    return selectedResults;
  }

  /**
   * 全文搜索检索
   */
  private async retrieveFts(
    query: string,
    n: number,
    tags: BranchAndDir[],
  ): Promise<Chunk[]> {
    if (query.trim() === "") {
      return [];
    }

    // 清理查询文本，提取关键词
    const keywords = await this.extractLLMKeywords(query);
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
    n: number,
  ): Promise<ScoredChunk[]> {
    const results: ScoredChunk[] = [];
    const keywords = await this.extractLLMKeywords(userRequest);
    const keywordPattern = new RegExp(keywords.join("|"), "i");

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
              const lines = content.split("\n");
              const chunkSize = Math.min(40, lines.length);
              const chunk = lines.slice(0, chunkSize).join("\n");

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
    baseScore: number,
  ): ScoredChunk[] {
    return chunks.map((chunk, index) => ({
      file: chunk.filepath,
      start_line: chunk.startLine || 1,
      score: baseScore - index * 0.1, // 排序越靠前分数越高
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
  private isPathMatch(
    originalPath: string,
    chunkPath: string,
    originalLine: number,
    chunkLine: number,
  ): boolean {
    // 标准化路径 - 统一使用正斜杠
    const normalizedOrigPath = originalPath.replace(/\\/g, "/");
    const normalizedChunkPath = chunkPath.replace(/\\/g, "/");

    // 1. 完全匹配（路径和行号都相等）
    if (
      normalizedOrigPath === normalizedChunkPath &&
      originalLine === chunkLine
    ) {
      return true;
    }

    // 2. 路径匹配检查（先检查路径，再考虑行号容错）
    let pathMatches = false;

    // 2.1 完全路径匹配
    if (normalizedOrigPath === normalizedChunkPath) {
      pathMatches = true;
    } else {
      // 2.2 进行智能路径匹配
      pathMatches = this.isPathSimilar(normalizedOrigPath, normalizedChunkPath);
    }

    // 如果路径不匹配，直接返回false
    if (!pathMatches) {
      return false;
    }

    // 3. 行号容错匹配（只有在路径匹配的情况下才进行）
    return this.isLineNumberMatch(originalLine, chunkLine);
  }

  /**
   * 检查两个路径是否相似
   */
  private isPathSimilar(
    normalizedOrigPath: string,
    normalizedChunkPath: string,
  ): boolean {
    // 2. 智能文件名匹配 - 处理文件名可能在不同目录的情况
    const origFileName = this.extractFileName(normalizedOrigPath);
    const chunkFileName = this.extractFileName(normalizedChunkPath);

    // 如果文件名完全不同，进行更宽松的匹配
    if (origFileName !== chunkFileName) {
      // 检查是否是同一个类但在不同的子目录中
      // 例如: TaRole.java vs entity/TaRole.java
      const origBaseName = origFileName.replace(/\.(java|kt|scala|xml)$/, "");
      const chunkBaseName = chunkFileName.replace(/\.(java|kt|scala|xml)$/, "");

      // 特殊处理XML文件的命名变体
      if (origFileName.endsWith(".xml") && chunkFileName.endsWith(".xml")) {
        if (this.isXmlFileNameSimilar(origBaseName, chunkBaseName)) {
          // XML文件名相似，继续其他匹配检查
        } else {
          return false;
        }
      } else if (origBaseName !== chunkBaseName) {
        // 对于Java文件，检查是否一个包含另一个（处理内部类等情况）
        if (
          !origBaseName.includes(chunkBaseName) &&
          !chunkBaseName.includes(origBaseName)
        ) {
          // 检查是否是常见命名变体
          if (!this.isFileNameVariant(origBaseName, chunkBaseName)) {
            return false;
          }
        }
      }
    }

    // 3. 智能路径匹配 - 处理包名差异和路径前缀差异
    const origPathParts = normalizedOrigPath
      .split("/")
      .filter((part: string) => part.length > 0);
    const chunkPathParts = normalizedChunkPath
      .split("/")
      .filter((part: string) => part.length > 0);

    // 提取关键路径信息
    const origInfo = this.extractPathInfo(origPathParts);
    const chunkInfo = this.extractPathInfo(chunkPathParts);

    // 4. 检查路径有效性
    if (chunkInfo.isValid === false) {
      console.warn(`🚨 检测到损坏的LLM路径: ${normalizedChunkPath}`);
      // 对于损坏的路径，降低匹配标准，主要基于文件名和项目信息
      if (origInfo.fileName && chunkInfo.fileName) {
        const origBaseName = origInfo.fileName.replace(
          /\.(java|xml|kt|scala)$/,
          "",
        );
        const chunkBaseName = chunkInfo.fileName.replace(
          /\.(java|xml|kt|scala)$/,
          "",
        );

        // 如果文件名有一定相似性，且项目信息匹配，则认为可能是同一文件
        if (
          this.isFileNameVariant(origBaseName, chunkBaseName) &&
          origInfo.projectName &&
          chunkInfo.projectName &&
          this.isProjectNameMatch(origInfo.projectName, chunkInfo.projectName)
        ) {
          console.warn(
            `🔧 基于文件名和项目信息的模糊匹配: ${origBaseName} ≈ ${chunkBaseName}`,
          );
          return true;
        }
      }
      return false; // 损坏路径且无法模糊匹配，直接拒绝
    }

    // 5. 基于关键信息的匹配
    // 检查项目/模块名匹配
    if (origInfo.projectName && chunkInfo.projectName) {
      if (
        !this.isProjectNameMatch(origInfo.projectName, chunkInfo.projectName)
      ) {
        // 项目名不匹配，但可能是简化版本，继续其他检查
      }
    }

    // 检查包名匹配（处理com.yinhai vs yinhai的情况）
    if (origInfo.packagePath && chunkInfo.packagePath) {
      if (
        this.isPackagePathMatch(origInfo.packagePath, chunkInfo.packagePath)
      ) {
        return true;
      }
    }

    // 特殊处理XML文件的路径匹配
    if (origInfo.fileType === "xml" && chunkInfo.fileType === "xml") {
      if (this.isXmlPathMatch(origInfo, chunkInfo)) {
        return true;
      }
    }

    // 5. 从后往前的路径匹配（原有逻辑，但更宽松）
    const minLength = Math.min(origPathParts.length, chunkPathParts.length);
    let matchCount = 0;
    let consecutiveMatches = 0;

    for (let i = 1; i <= minLength; i++) {
      const origPart = origPathParts[origPathParts.length - i];
      const chunkPart = chunkPathParts[chunkPathParts.length - i];

      if (origPart === chunkPart) {
        matchCount++;
        consecutiveMatches++;
      } else {
        // 允许一些常见的差异
        if (this.isPathPartSimilar(origPart, chunkPart)) {
          matchCount++;
          consecutiveMatches++;
        } else {
          consecutiveMatches = 0;
        }
      }
    }

    // 如果有足够的连续匹配，认为是同一个文件
    if (consecutiveMatches >= 2 || matchCount >= 3) {
      return true;
    }

    // 6. 模糊匹配 - 检查关键路径部分
    const commonDirs = new Set([
      "src",
      "main",
      "java",
      "resources",
      "test",
      "target",
      "classes",
      "com",
      "org",
      "net", // 常见包前缀
      "entity",
      "dto",
      "vo",
      "domain",
      "service",
      "controller",
      "repository", // 常见目录
    ]);

    const origKeyParts = origPathParts.filter(
      (part: string) => !commonDirs.has(part),
    );
    const chunkKeyParts = chunkPathParts.filter(
      (part: string) => !commonDirs.has(part),
    );

    // 检查关键部分的相似度
    const similarity = this.calculatePathSimilarity(
      origKeyParts,
      chunkKeyParts,
    );
    if (similarity > 0.6) {
      // 60%相似度阈值
      return true;
    }

    // 7. 包含关系匹配 - 一个路径包含另一个路径的关键部分
    const origKeyPath = origKeyParts.join("/");
    const chunkKeyPath = chunkKeyParts.join("/");

    if (origKeyPath.length > 0 && chunkKeyPath.length > 0) {
      if (
        origKeyPath.includes(chunkKeyPath) ||
        chunkKeyPath.includes(origKeyPath)
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * 行号容错匹配 - 允许一定范围内的行号差异
   * @param originalLine 原始行号
   * @param chunkLine LLM返回的行号
   */
  private isLineNumberMatch(originalLine: number, chunkLine: number): boolean {
    // 1. 完全匹配
    if (originalLine === chunkLine) {
      return true;
    }

    const lineDiff = Math.abs(originalLine - chunkLine);

    // 2. 允许小范围的行号差异（±10行）
    if (lineDiff <= 10) {
      return true;
    }

    // 3. 特殊情况：如果其中一个行号是1，另一个在合理范围内，也认为匹配
    // 这处理了LLM可能返回文件开头行号的情况，但要排除已经被小范围差异覆盖的情况
    if (
      (originalLine === 1 && chunkLine <= 50 && lineDiff > 10) ||
      (chunkLine === 1 && originalLine <= 50 && lineDiff > 10)
    ) {
      return true;
    }

    // 4. 对于较大的文件，允许更大的行号差异
    // 如果原始行号较大，说明是大文件，可以允许更大的容错范围
    if (originalLine > 100) {
      // 对于大文件，允许±5%的行号差异，但最多不超过50行
      const allowedDiff = Math.min(Math.floor(originalLine * 0.05), 50);
      if (lineDiff <= allowedDiff) {
        return true;
      }
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
   * 提取路径关键信息（改进版，支持XML和损坏路径处理）
   */
  private extractPathInfo(pathParts: string[]): {
    projectName?: string;
    packagePath?: string;
    fileName?: string;
    fileType?: string;
    isValid?: boolean;
  } {
    if (pathParts.length === 0) {
      return { isValid: false };
    }

    const fileName = pathParts[pathParts.length - 1];
    let packagePath = "";
    let projectName = "";
    let fileType = "unknown";
    let isValid = true;

    // 检测文件类型
    if (fileName) {
      if (fileName.endsWith(".java")) {
        fileType = "java";
      } else if (fileName.endsWith(".xml")) {
        fileType = "xml";
      } else if (fileName.endsWith(".kt")) {
        fileType = "kotlin";
      } else if (fileName.endsWith(".scala")) {
        fileType = "scala";
      }
    }

    // 检查路径是否损坏（包含明显错误的部分）
    const pathString = pathParts.join("/");
    if (this.isPathCorrupted(pathString)) {
      isValid = false;
    }

    // 根据文件类型提取包路径
    if (fileType === "java" || fileType === "kotlin" || fileType === "scala") {
      // 查找java目录的位置，从那里开始是包路径
      const javaIndex = pathParts.findIndex((part) => part === "java");
      if (javaIndex >= 0 && javaIndex < pathParts.length - 1) {
        packagePath = pathParts.slice(javaIndex + 1, -1).join("/");
      }
    } else if (fileType === "xml") {
      // 对于XML文件，查找resources目录
      const resourcesIndex = pathParts.findIndex(
        (part) => part === "resources",
      );
      if (resourcesIndex >= 0 && resourcesIndex < pathParts.length - 1) {
        packagePath = pathParts.slice(resourcesIndex + 1, -1).join("/");
      }
    }

    // 尝试提取项目名（通常在ta404, component等关键词附近）
    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i];
      if (
        part.includes("ta404") ||
        part.includes("ta3404") ||
        part.includes("component")
      ) {
        projectName = part;
        break;
      }
    }

    return { projectName, packagePath, fileName, fileType, isValid };
  }

  /**
   * 检查路径是否损坏
   */
  private isPathCorrupted(pathString: string): boolean {
    // 检查常见的路径损坏模式
    const corruptionPatterns = [
      /com\/yai\/ta\/domain\/coreuserauth/, // 缺少部分包名
      /aggregaterole\/repository\/writeaRole/, // 连接错误的路径部分
      /writeaRoleWriteRepository/, // 重复或错误的类名
      /[a-zA-Z]{50,}/, // 异常长的单个路径部分
      /\/\/+/, // 多个连续斜杠
      /[^a-zA-Z0-9\/\-_\.]/, // 包含异常字符
    ];

    return corruptionPatterns.some((pattern) => pattern.test(pathString));
  }

  /**
   * XML文件路径匹配
   */
  private isXmlPathMatch(origInfo: any, chunkInfo: any): boolean {
    // 检查文件名相似性
    if (origInfo.fileName && chunkInfo.fileName) {
      const origBaseName = origInfo.fileName.replace(/\.xml$/, "");
      const chunkBaseName = chunkInfo.fileName.replace(/\.xml$/, "");

      if (!this.isXmlFileNameSimilar(origBaseName, chunkBaseName)) {
        return false;
      }
    }

    // 检查XML特定的路径结构
    if (origInfo.packagePath && chunkInfo.packagePath) {
      // 移除XML特定的子目录差异
      const origXmlPath = origInfo.packagePath.replace(
        /\/(read|write|query|command)$/,
        "",
      );
      const chunkXmlPath = chunkInfo.packagePath.replace(
        /\/(read|write|query|command)$/,
        "",
      );

      // 检查核心路径是否匹配
      if (origXmlPath === chunkXmlPath) {
        return true;
      }

      // 检查是否包含关系
      if (
        origXmlPath.includes(chunkXmlPath) ||
        chunkXmlPath.includes(origXmlPath)
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * 检查项目名是否匹配
   */
  private isProjectNameMatch(orig: string, chunk: string): boolean {
    // 完全匹配
    if (orig === chunk) return true;

    // 一个包含另一个
    if (orig.includes(chunk) || chunk.includes(orig)) return true;

    // 都包含关键词
    const keywords = ["ta404", "component", "domain", "core"];
    const origKeywords = keywords.filter((kw: string) => orig.includes(kw));
    const chunkKeywords = keywords.filter((kw: string) => chunk.includes(kw));

    return (
      origKeywords.length > 0 &&
      chunkKeywords.length > 0 &&
      origKeywords.some((kw) => chunkKeywords.includes(kw))
    );
  }

  /**
   * 检查包路径是否匹配
   */
  private isPackagePathMatch(orig: string, chunk: string): boolean {
    // 完全匹配
    if (orig === chunk) return true;

    // 处理com.yinhai vs yinhai的情况
    const origParts = orig.split("/").filter((p: string) => p.length > 0);
    const chunkParts = chunk.split("/").filter((p: string) => p.length > 0);

    // 移除常见包前缀
    const origFiltered = origParts.filter(
      (p: string) => !["com", "org", "net"].includes(p),
    );
    const chunkFiltered = chunkParts.filter(
      (p: string) => !["com", "org", "net"].includes(p),
    );

    // 检查过滤后的包路径
    const origFilteredPath = origFiltered.join("/");
    const chunkFilteredPath = chunkFiltered.join("/");

    if (origFilteredPath === chunkFilteredPath) return true;

    // 检查一个是否包含另一个
    if (
      origFilteredPath.includes(chunkFilteredPath) ||
      chunkFilteredPath.includes(origFilteredPath)
    )
      return true;

    // 检查后缀匹配（从后往前匹配至少2个部分）
    const minLength = Math.min(origFiltered.length, chunkFiltered.length);
    let matchCount = 0;

    for (let i = 1; i <= minLength && i <= 3; i++) {
      const origPart = origFiltered[origFiltered.length - i];
      const chunkPart = chunkFiltered[chunkFiltered.length - i];

      if (origPart === chunkPart) {
        matchCount++;
      } else {
        break;
      }
    }

    return matchCount >= 2;
  }

  /**
   * 检查路径部分是否相似
   */
  private isPathPartSimilar(orig: string, chunk: string): boolean {
    // 完全匹配
    if (orig === chunk) return true;

    // 一个包含另一个
    if (orig.includes(chunk) || chunk.includes(orig)) return true;

    // 检查是否是常见变体
    const variants = [
      ["entity", "entities"],
      ["dto", "dtos"],
      ["vo", "vos"],
      ["domain", "domains"],
      ["aggregate", "aggregates"],
      ["service", "services"],
      ["repository", "repositories"],
      ["controller", "controllers"],
    ];

    for (const [v1, v2] of variants) {
      if ((orig === v1 && chunk === v2) || (orig === v2 && chunk === v1)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 计算路径相似度 - 改进版本，优先考虑文件名匹配
   */
  private calculatePathSimilarity(
    origParts: string[],
    chunkParts: string[],
  ): number {
    if (origParts.length === 0 && chunkParts.length === 0) return 1.0;
    if (origParts.length === 0 || chunkParts.length === 0) return 0.0;

    // 提取文件名
    const origFileName = origParts[origParts.length - 1] || "";
    const chunkFileName = chunkParts[chunkParts.length - 1] || "";

    // 如果文件名完全相同，给予很高的基础分数
    let baseScore = 0;
    if (origFileName === chunkFileName) {
      baseScore = 0.8; // 同名文件基础分数80%
    } else {
      // 检查文件名相似性（去除扩展名）
      const origBaseName = origFileName.replace(/\.(java|xml|kt|scala)$/, "");
      const chunkBaseName = chunkFileName.replace(/\.(java|xml|kt|scala)$/, "");

      if (origBaseName === chunkBaseName) {
        baseScore = 0.7; // 同基础名文件70%
      } else if (this.isFileNameVariant(origBaseName, chunkBaseName)) {
        baseScore = 0.5; // 文件名变体50%
      } else {
        baseScore = 0.1; // 不同文件名只有10%
      }
    }

    // 计算路径部分的相似度（除了文件名）
    const origPathParts = origParts.slice(0, -1);
    const chunkPathParts = chunkParts.slice(0, -1);

    const origSet = new Set(origPathParts);
    const chunkSet = new Set(chunkPathParts);

    // 计算交集
    const origArray = Array.from(origSet);
    const intersection = new Set(
      origArray.filter((x: string) => chunkSet.has(x)),
    );

    // 计算并集
    const origArrayForUnion = Array.from(origSet);
    const chunkArrayForUnion = Array.from(chunkSet);
    const union = new Set([...origArrayForUnion, ...chunkArrayForUnion]);

    // 路径相似度（Jaccard相似度）
    const pathSimilarity =
      union.size > 0 ? intersection.size / union.size : 1.0;

    // 综合分数：文件名权重70%，路径权重30%
    return baseScore * 0.7 + pathSimilarity * 0.3;
  }

  /**
   * 检查XML文件名是否相似
   */
  private isXmlFileNameSimilar(orig: string, chunk: string): boolean {
    // 完全匹配
    if (orig === chunk) return true;

    // 移除常见的XML文件后缀变体
    const origCore = orig.replace(/(Read|Write|Query|Command|Mapper)$/, "");
    const chunkCore = chunk.replace(/(Read|Write|Query|Command|Mapper)$/, "");

    // 核心名称匹配
    if (origCore === chunkCore && origCore.length > 0) return true;

    // 检查一个是否包含另一个
    if (orig.includes(chunk) || chunk.includes(orig)) return true;

    // 检查是否是常见的MyBatis Mapper变体
    const mapperVariants = [
      [orig + "Mapper", chunk],
      [orig, chunk + "Mapper"],
      [orig + "ReadMapper", chunk + "Mapper"],
      [orig + "WriteMapper", chunk + "Mapper"],
      [orig + "Mapper", chunk + "ReadMapper"],
      [orig + "Mapper", chunk + "WriteMapper"],
    ];

    for (const [v1, v2] of mapperVariants) {
      if (v1 === v2) return true;
    }

    return false;
  }

  /**
   * 检查文件名是否是常见变体
   */
  private isFileNameVariant(orig: string, chunk: string): boolean {
    // 完全匹配
    if (orig === chunk) return true;

    // 检查一个是否包含另一个
    if (orig.includes(chunk) || chunk.includes(orig)) return true;

    // 常见的Java类名变体
    const javaVariants = [
      // Repository变体
      [orig + "Repository", chunk],
      [orig, chunk + "Repository"],
      [orig + "ReadRepository", chunk + "Repository"],
      [orig + "WriteRepository", chunk + "Repository"],
      [orig + "Repository", chunk + "ReadRepository"],
      [orig + "Repository", chunk + "WriteRepository"],

      // Service变体
      [orig + "Service", chunk],
      [orig, chunk + "Service"],
      [orig + "ServiceImpl", chunk + "Service"],
      [orig + "Service", chunk + "ServiceImpl"],

      // Entity变体
      [orig + "Entity", chunk],
      [orig, chunk + "Entity"],

      // DTO/VO变体
      [orig + "DTO", chunk],
      [orig, chunk + "DTO"],
      [orig + "VO", chunk],
      [orig, chunk + "VO"],

      // Controller变体
      [orig + "Controller", chunk],
      [orig, chunk + "Controller"],
    ];

    for (const [v1, v2] of javaVariants) {
      if (v1 === v2) return true;
    }

    // 检查是否是缩写或展开形式
    if (this.isAbbreviationMatch(orig, chunk)) return true;

    return false;
  }

  /**
   * 检查是否是缩写匹配
   */
  private isAbbreviationMatch(orig: string, chunk: string): boolean {
    // 检查常见的缩写模式
    const abbreviations = [
      ["Ta", "Table"],
      ["Mgmt", "Management"],
      ["Auth", "Authentication"],
      ["Org", "Organization"],
      ["User", "UserAuth"],
      ["Role", "RoleManagement"],
    ];

    for (const [abbr, full] of abbreviations) {
      if (
        (orig.includes(abbr) && chunk.includes(full)) ||
        (orig.includes(full) && chunk.includes(abbr))
      ) {
        return true;
      }
    }

    return false;
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
    highScoreThreshold: number = 9.8,
  ): RelevanceScore[] {
    if (!scores.length) {
      return [];
    }

    // 按分数降序排序
    const sortedScores = scores.sort((a, b) => b.score - a.score);

    // 找到所有高分片段
    const highScoreSnippets = sortedScores.filter(
      (score) => score.score >= highScoreThreshold,
    );

    if (highScoreSnippets.length > topN) {
      // 如果高分片段数量超过topN，保留所有高分片段
      return highScoreSnippets;
    } else if (highScoreSnippets.length === topN) {
      // 如果高分片段数量正好等于topN，直接返回
      return highScoreSnippets;
    } else {
      // 如果高分片段数量少于topN，补充其他片段到topN
      const remainingSlots = topN - highScoreSnippets.length;
      const otherSnippets = sortedScores
        .filter((score: any) => score.score < highScoreThreshold)
        .slice(0, remainingSlots);

      const result = [...highScoreSnippets, ...otherSnippets];
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
    highScoreThreshold: number = 9.0,
  ): ScoredChunk[] {
    if (!chunks.length) {
      return [];
    }

    // 按分数降序排序
    const sortedChunks = chunks.sort((a, b) => b.score - a.score);

    // 找到所有高分片段
    const highScoreChunks = sortedChunks.filter(
      (chunk) => chunk.score >= highScoreThreshold,
    );

    if (highScoreChunks.length > topN) {
      // 如果高分片段数量超过topN，保留所有高分片段
      return highScoreChunks;
    } else if (highScoreChunks.length === topN) {
      // 如果高分片段数量正好等于topN，直接返回
      return highScoreChunks;
    } else {
      // 如果高分片段数量少于topN，补充其他片段到topN
      const remainingSlots = topN - highScoreChunks.length;
      const otherChunks = sortedChunks
        .filter((chunk: any) => chunk.score < highScoreThreshold)
        .slice(0, remainingSlots);

      const result = [...highScoreChunks, ...otherChunks];

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
      // 构建代码片段描述，使用ID索引
      const snippetDescriptions = snippets.map((snippet, index) => {
        // 查找或创建snippet对应的ID
        let id: number | undefined;
        const existingId = Object.keys(this.codeChunkIndex).find((key) => {
          const storedChunk = this.codeChunkIndex[parseInt(key)];
          return (
            storedChunk.file_path === snippet.file &&
            storedChunk.start_line === snippet.start_line
          );
        });

        if (existingId) {
          id = parseInt(existingId);
        } else {
          // 创建新的ID
          id = this.nextChunkId++;
          this.codeChunkIndex[id] = {
            file_path: snippet.file,
            start_line: snippet.start_line,
            chunk: snippet.code,
          };
        }

        return `【代码片段 ${id}】
文件: ${snippet.file}
起始行: ${snippet.start_line}
模块: ${snippet.module || "未知"}
评分: ${snippet.score.toFixed(3)}
代码内容:
\`\`\`java
${snippet.code.substring(0, 1000)}${snippet.code.length > 1000 ? "..." : ""}
\`\`\``;
      });

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
                      id: {
                        type: "number",
                        description: "代码块ID",
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
                    required: ["id", "is_relevant", "reason"],
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
          // 添加详细的异常堆栈信息
          if (extractError instanceof Error && extractError.stack) {
            console.error("🔍 异常堆栈信息:", extractError.stack);
          }
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
    batchSize: number = 15,
  ): Promise<ScoredChunk[]> {
    if (!Object.keys(moduleFileMap).length || !userRequest) {
      throw new Error("模块文件映射和用户请求必须提供且非空");
    }

    try {
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

        // 为备选方案的代码片段生成总结并输出到日志
        this.generateAndLogSummaries(fallbackSnippets, userRequest);

        return fallbackSnippets;
      }

      return filteredResults;
    } catch (error) {
      // 重新抛出异常
      throw error;
    }
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

    // 为所有读取的代码块生成总结并输出到日志
    this.logAllCodeChunks(moduleName, moduleChunks);

    // 使用智能预过滤策略
    const chunksToAnalyze = await this.smartPreFilter(
      moduleChunks,
      userRequest,
    );

    chunksToAnalyze.forEach((chunk, index) => {
      const lines = chunk.chunk.split("\n");
      const endLine = chunk.start_line + lines.length - 1;
      const charCount = chunk.chunk.length;
    });

    // 为代码块分配ID并建立索引
    const chunkDescriptions = chunksToAnalyze.map((chunk, index) => {
      // 为每个代码块分配唯一ID并存储在索引中
      const id = this.nextChunkId++;
      this.codeChunkIndex[id] = chunk;

      return `【Code Chunk ${id}】File: ${chunk.file_path}\nStart Line: ${chunk.start_line}\nContent:\n\`\`\`java\n${chunk.chunk.substring(0, 1000)}${chunk.chunk.length > 1000 ? "..." : ""}\n\`\`\``;
    });

    // 对该模块的代码块进行批处理评分
    const moduleScores: RelevanceScore[] = [];
    const batchTasks: Promise<{
      batchIndex: number;
      scores: RelevanceScore[];
      error?: Error;
    }>[] = [];

    const totalBatches = Math.ceil(moduleChunks.length / batchSize);

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
          const defaultScores = batch.map((chunk) => {
            // 查找chunk对应的ID
            const id = Object.keys(this.codeChunkIndex).find((key) => {
              const storedChunk = this.codeChunkIndex[parseInt(key)];
              return (
                storedChunk.file_path === chunk.file_path &&
                storedChunk.start_line === chunk.start_line
              );
            });

            return {
              id: id ? parseInt(id) : undefined,
              file: chunk.file_path,
              start_line: chunk.start_line,
              score: 0,
            };
          });
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
    const selectedChunks = this.selectTopSnippetsWithHighScorePreservation(
      moduleScores,
      topN,
    );

    // 构建该模块的结果
    const moduleResults: ScoredChunk[] = [];

    for (const chunk of selectedChunks) {
      // 使用ID查找原始代码块
      if (chunk.id && this.codeChunkIndex[chunk.id]) {
        const origChunk = this.codeChunkIndex[chunk.id];
        moduleResults.push({
          file: origChunk.file_path,
          start_line: origChunk.start_line,
          score: chunk.score,
          code: origChunk.chunk,
          module: moduleName, // 添加模块信息
        });
      } else {
        // 如果没有ID或找不到对应的代码块，尝试使用旧的路径匹配方式
        let matched = false;
        for (const origChunk of moduleChunks) {
          // 使用更宽松的路径匹配逻辑
          if (
            this.isPathMatch(
              origChunk.file_path,
              chunk.file,
              origChunk.start_line,
              chunk.start_line,
            )
          ) {
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

          // 输出详细的调试信息
          console.warn(`   LLM返回路径: ${chunk.file}`);
          console.warn(`   可用的原始代码块路径示例:`);
          moduleChunks.slice(0, 3).forEach((c, index) => {
            console.warn(`     ${index + 1}. ${c.file_path}:${c.start_line}`);
          });

          // 尝试找到最相似的路径 - 优先考虑同名文件
          let bestMatch = null;
          let bestSimilarity = 0;
          let sameNameMatches: any[] = [];

          // 首先查找同名文件
          const chunkFileName = this.extractFileName(chunk.file);
          for (const origChunk of moduleChunks) {
            const origFileName = this.extractFileName(origChunk.file_path);
            if (origFileName === chunkFileName) {
              sameNameMatches.push(origChunk);

              // 如果同名文件且行号匹配或接近，直接使用
              if (
                this.isLineNumberMatch(origChunk.start_line, chunk.start_line)
              ) {
                console.warn(
                  `🎯 找到同名文件且行号匹配: ${origChunk.file_path}:${origChunk.start_line} ≈ ${chunk.file}:${chunk.start_line}`,
                );
                bestMatch = origChunk;
                bestSimilarity = 1.0;
                break;
              }
            }
          }

          // 如果没有找到行号匹配的同名文件，从候选中选择最佳匹配
          if (bestSimilarity < 1.0) {
            const candidateChunks =
              sameNameMatches.length > 0
                ? sameNameMatches
                : moduleChunks.slice(0, 20);

            for (const origChunk of candidateChunks) {
              const origParts = origChunk.file_path
                .replace(/\\/g, "/")
                .split("/")
                .filter((p: string) => p.length > 0);
              const chunkParts = chunk.file
                .replace(/\\/g, "/")
                .split("/")
                .filter((p: string) => p.length > 0);

              const similarity = this.calculatePathSimilarity(
                origParts,
                chunkParts,
              );
              if (similarity > bestSimilarity) {
                bestSimilarity = similarity;
                bestMatch = origChunk;
              }
            }
          }

          if (bestMatch && bestSimilarity > 0.1) {
            const isSameName = sameNameMatches.length > 0;
            console.warn(
              `   最相似路径 (${(bestSimilarity * 100).toFixed(1)}%${isSameName ? ", 同名文件" : ""}): ${bestMatch.file_path}:${bestMatch.start_line}`,
            );

            if (sameNameMatches.length > 1) {
              console.warn(`   找到 ${sameNameMatches.length} 个同名文件候选`);
            }

            // 分析为什么没有匹配
            const origInfo = this.extractPathInfo(
              bestMatch.file_path.replace(/\\/g, "/").split("/"),
            );
            const chunkInfo = this.extractPathInfo(
              chunk.file.replace(/\\/g, "/").split("/"),
            );

            console.warn(`   路径分析:`);
            console.warn(
              `     原始项目: ${origInfo.projectName || "N/A"}, 包路径: ${origInfo.packagePath || "N/A"}, 文件: ${origInfo.fileName || "N/A"}`,
            );
            console.warn(
              `     LLM项目: ${chunkInfo.projectName || "N/A"}, 包路径: ${chunkInfo.packagePath || "N/A"}, 文件: ${chunkInfo.fileName || "N/A"}`,
            );
            console.warn(
              `     行号匹配: ${bestMatch.start_line === chunk.start_line ? "✅" : "❌"} (${bestMatch.start_line} vs ${chunk.start_line})`,
            );
          }
        }
      }
    }

    return moduleResults;
  }

  /**
   * 为所有读取的代码块生成总结并输出到日志
   * @param moduleName 模块名称
   * @param codeChunks 原始代码块数组
   */
  private logAllCodeChunks(moduleName: string, codeChunks: CodeChunk[]): void {
    if (!this.enableSummaries || !this.llm || codeChunks.length === 0) {
      return;
    }

    // 异步执行，不阻塞主流程
    Promise.resolve().then(async () => {
      try {
        console.log(
          `📚 模块 ${moduleName} 读取了 ${codeChunks.length} 个代码块，开始生成总结...`,
        );

        // 将 CodeChunk 转换为 ScoredChunk 格式以便复用现有的总结方法
        const scoredChunks: ScoredChunk[] = codeChunks.map((chunk) => ({
          file: chunk.file_path,
          start_line: chunk.start_line,
          score: 1.0, // 给所有代码块一个默认分数
          code: chunk.chunk,
          module: moduleName,
        }));

        // 生成代码片段总结并输出到日志
        await this.logCodeSummaries(scoredChunks);

        // 为该模块生成总结
        const moduleChunks = new Map<string, ScoredChunk[]>();
        moduleChunks.set(moduleName, scoredChunks);
        await this.logModuleSummaries(moduleChunks);
      } catch (error) {
        console.warn(
          `⚠️ 模块 ${moduleName} 代码块总结生成失败:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    });
  }

  /**
   * 为代码片段生成简短总结并输出到日志
   * @param codeChunks 代码片段数组
   */
  private async logCodeSummaries(codeChunks: ScoredChunk[]): Promise<void> {
    if (!this.llm || !codeChunks.length) {
      return;
    }

    try {
      // 设置批处理大小
      const batchSize = 10; // 每批处理10个代码块
      const totalBatches = Math.ceil(codeChunks.length / batchSize);

      console.log(
        `🔍 开始生成代码片段总结，共${codeChunks.length}个代码块，分${totalBatches}批处理...`,
      );

      // 分批处理代码块总结
      for (let i = 0; i < codeChunks.length; i += batchSize) {
        const batchIndex = Math.floor(i / batchSize) + 1;
        const batch = codeChunks.slice(i, i + batchSize);

        console.log(
          `   处理第${batchIndex}/${totalBatches}批，包含${batch.length}个代码块...`,
        );

        // 构建代码片段描述
        const chunkDescriptions = batch.map(
          (chunk, index) =>
            `【代码片段 ${i + index + 1}】
文件: ${chunk.file}
起始行: ${chunk.start_line}
代码内容:
\`\`\`java
${chunk.code.substring(0, 800)}${chunk.code.length > 800 ? "..." : ""}
\`\`\``,
        );

        const userContent = `请为以下代码片段生成简短总结：

${chunkDescriptions.join("\n\n")}`;

        // 重置之前的结果
        this.toolCallResults.codeSummaries = undefined;

        // 创建带超时的 AbortController
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => {
          abortController.abort();
        }, 30000); // 30秒超时

        const messages: ChatMessage[] = [
          {
            role: "system",
            content: this.summarySystemPrompt,
          },
          { role: "user", content: userContent },
        ];

        const response = await this.llm.chat(messages, abortController.signal, {
          temperature: 0.0,
          maxTokens: 4096,
        });

        clearTimeout(timeoutId);

        // 处理LLM响应内容
        const content = response.content;
        if (typeof content === "string") {
          try {
            const args = this.extractToolCallArgs(
              content,
              "submitCodeSummaries",
            );

            if (args.summaries && Array.isArray(args.summaries)) {
              this.submitCodeSummaries(args.summaries);
            } else {
              console.warn("⚠️ 工具调用参数中缺少 summaries 数组");
            }
          } catch (extractError) {
            console.error(
              "❌ 从内容中提取代码总结失败:",
              extractError instanceof Error
                ? extractError.message
                : String(extractError),
            );
          }
        }

        // 检查是否有工具调用结果并输出到日志
        const codeSummaries = this.toolCallResults.codeSummaries;
        if (codeSummaries && Array.isArray(codeSummaries)) {
          const summaries = codeSummaries as CodeSummary[];
          if (summaries.length > 0) {
            console.log(`📄 第${batchIndex}批代码片段总结:`);
            summaries.forEach((summary, index) => {
              console.log(
                `  ${i + index + 1}. ${summary.file}:${summary.start_line}`,
              );
              console.log(`     总结: ${summary.summary}`);
            });
          } else {
            console.warn(`⚠️ 第${batchIndex}批代码总结结果为空`);
          }
        } else {
          console.warn(`⚠️ 无法获取第${batchIndex}批代码总结结果`);
        }

        // 添加小延迟避免过于频繁的请求
        if (batchIndex < totalBatches) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      console.log(
        `✅ 代码片段总结生成完成，共处理${codeChunks.length}个代码块`,
      );
    } catch (error) {
      console.warn(
        "⚠️ 生成代码总结过程出错:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * 为模块生成总结并输出到日志
   * @param moduleChunks 按模块分组的代码片段
   */
  private async logModuleSummaries(
    moduleChunks: Map<string, ScoredChunk[]>,
  ): Promise<void> {
    if (!this.llm || moduleChunks.size === 0) {
      return;
    }

    console.log("📊 开始生成模块总结...");

    // 存储所有模块的总结
    const allModulesSummaries: { moduleName: string; summary: string }[] = [];

    const moduleEntries = Array.from(moduleChunks.entries());

    // 串行处理每个模块，确保一个模块处理完成后再处理下一个模块
    for (const [moduleName, chunks] of moduleEntries) {
      console.log(`▶️ 开始处理模块: ${moduleName}`);
      try {
        // 设置批处理大小
        const batchSize = 20; // 每批处理20个代码块
        const totalBatches = Math.ceil(chunks.length / batchSize);
        const allSummaries: ModuleSummary[] = [];

        console.log(
          `   模块 ${moduleName} 包含 ${chunks.length} 个代码块，分 ${totalBatches} 批处理`,
        );

        // 分批处理代码块总结
        for (let i = 0; i < chunks.length; i += batchSize) {
          const batchIndex = Math.floor(i / batchSize) + 1;
          const batch = chunks.slice(i, i + batchSize);

          console.log(
            `     处理第${batchIndex}/${totalBatches}批，包含${batch.length}个代码块...`,
          );

          // 构建模块的代码描述（基于代码内容而不是总结）
          const chunkDescriptions = batch.map((chunk, index) => {
            const codePreview = chunk.code
              .substring(0, 200)
              .replace(/\n/g, " ");
            return `${i + index + 1}. ${chunk.file}:${chunk.start_line} - ${codePreview}${chunk.code.length > 200 ? "..." : ""}`;
          });

          const userContent = `模块名称: ${moduleName}
代码片段总数: ${chunks.length}

当前批处理信息:
批处理索引: ${batchIndex}/${totalBatches}
当前批处理代码片段数: ${batch.length}

代码片段:
${chunkDescriptions.join("\n")}

请为此模块生成一个综合性的总结。`;

          // 重置之前的结果
          this.toolCallResults.moduleSummaries = undefined;

          // 创建带超时的 AbortController
          const abortController = new AbortController();
          const timeoutId = setTimeout(() => {
            abortController.abort();
          }, 25000); // 25秒超时

          const messages: ChatMessage[] = [
            {
              role: "system",
              content: this.moduleSummarySystemPrompt,
            },
            { role: "user", content: userContent },
          ];

          const response = await this.llm.chat(
            messages,
            abortController.signal,
            {
              temperature: 0.0,
              maxTokens: 2048,
            },
          );

          clearTimeout(timeoutId);

          // 处理LLM响应内容
          const content = response.content;
          if (typeof content === "string") {
            try {
              const args = this.extractToolCallArgs(
                content,
                "submitModuleSummaries",
              );

              if (args.summaries && Array.isArray(args.summaries)) {
                this.submitModuleSummaries(args.summaries);

                // 收集所有批次的总结
                const moduleResults = this.toolCallResults.moduleSummaries;
                if (
                  moduleResults !== undefined &&
                  Array.isArray(moduleResults)
                ) {
                  allSummaries.push(...(moduleResults as ModuleSummary[]));
                }
              } else {
                console.warn("⚠️ 工具调用参数中缺少 summaries 数组");
              }
            } catch (extractError) {
              console.error(
                "❌ 从内容中提取模块总结失败:",
                extractError instanceof Error
                  ? extractError.message
                  : String(extractError),
              );
            }
          }

          // 添加小延迟避免过于频繁的请求
          if (batchIndex < totalBatches) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }

        // 使用LLM汇总所有批次的总结生成最终的模块总结
        let finalSummary = "";
        if (allSummaries.length > 0) {
          console.log(
            `🏗️ 模块 ${moduleName} 批次处理完成，正在生成综合总结...`,
          );

          // 构建所有批次总结的描述
          const batchSummariesDescription = allSummaries
            .map(
              (summary, index) =>
                `总结 ${index + 1}: ${summary.summary} (涉及${summary.chunk_count}个代码片段)`,
            )
            .join("\n");

          const finalSummaryUserContent = `模块名称: ${moduleName}
代码片段总数: ${chunks.length}
批次总结数量: ${allSummaries.length}

各批次总结:
${batchSummariesDescription}

请基于以上所有批次的总结，生成一个综合性的模块总结。`;

          // 重置之前的结果
          this.toolCallResults.moduleSummaries = undefined;

          // 创建带超时的 AbortController
          const finalAbortController = new AbortController();
          const finalTimeoutId = setTimeout(() => {
            finalAbortController.abort();
          }, 25000); // 25秒超时

          const finalMessages: ChatMessage[] = [
            {
              role: "system",
              content: this.moduleSummarySystemPrompt,
            },
            { role: "user", content: finalSummaryUserContent },
          ];

          const finalResponse = await this.llm.chat(
            finalMessages,
            finalAbortController.signal,
            {
              temperature: 0.0,
              maxTokens: 2048,
            },
          );

          clearTimeout(finalTimeoutId);

          // 处理LLM响应内容
          const finalContent = finalResponse.content;
          if (typeof finalContent === "string") {
            try {
              const finalArgs = this.extractToolCallArgs(
                finalContent,
                "submitModuleSummaries",
              );

              if (finalArgs.summaries && Array.isArray(finalArgs.summaries)) {
                this.submitModuleSummaries(finalArgs.summaries);

                // 输出最终的模块总结
                const finalModuleResults = this.toolCallResults.moduleSummaries;
                if (
                  finalModuleResults !== undefined &&
                  Array.isArray(finalModuleResults)
                ) {
                  console.log(`🏗️ 模块 ${moduleName} 综合总结:`);
                  (finalModuleResults as ModuleSummary[]).forEach((summary) => {
                    console.log(`   总结: ${summary.summary}`);
                    console.log(`   片段数: ${summary.chunk_count}`);
                    finalSummary = summary.summary;
                  });
                } else {
                  // 如果无法获取最终总结，则输出所有批次的总结
                  console.log(`🏗️ 模块 ${moduleName} 批次总结:`);
                  allSummaries.forEach((summary) => {
                    console.log(`   总结: ${summary.summary}`);
                    console.log(`   片段数: ${summary.chunk_count}`);
                    // 使用第一个总结作为最终总结
                    if (!finalSummary) {
                      finalSummary = summary.summary;
                    }
                  });
                }
              } else {
                console.warn("⚠️ 工具调用参数中缺少 summaries 数组");
                // 如果无法获取最终总结，则输出所有批次的总结
                console.log(`🏗️ 模块 ${moduleName} 批次总结:`);
                allSummaries.forEach((summary) => {
                  console.log(`   总结: ${summary.summary}`);
                  console.log(`   片段数: ${summary.chunk_count}`);
                  // 使用第一个总结作为最终总结
                  if (!finalSummary) {
                    finalSummary = summary.summary;
                  }
                });
              }
            } catch (extractError) {
              console.error(
                "❌ 从内容中提取模块总结失败:",
                extractError instanceof Error
                  ? extractError.message
                  : String(extractError),
              );
              // 如果提取失败，则输出所有批次的总结
              console.log(`🏗️ 模块 ${moduleName} 批次总结:`);
              allSummaries.forEach((summary) => {
                console.log(`   总结: ${summary.summary}`);
                console.log(`   片段数: ${summary.chunk_count}`);
                // 使用第一个总结作为最终总结
                if (!finalSummary) {
                  finalSummary = summary.summary;
                }
              });
            }
          } else {
            // 如果无法获取最终总结，则输出所有批次的总结
            console.log(`🏗️ 模块 ${moduleName} 批次总结:`);
            allSummaries.forEach((summary) => {
              console.log(`   总结: ${summary.summary}`);
              console.log(`   片段数: ${summary.chunk_count}`);
              // 使用第一个总结作为最终总结
              if (!finalSummary) {
                finalSummary = summary.summary;
              }
            });
          }

          // 存储模块总结用于后续统一处理
          if (finalSummary) {
            allModulesSummaries.push({ moduleName, summary: finalSummary });
          }
        } else {
          console.log(
            `🏗️ 模块 ${moduleName}: 包含 ${chunks.length} 个代码片段`,
          );
        }

        console.log(`✅ 模块 ${moduleName} 处理完成`);

        // 在处理完一个模块后添加延迟，确保模块间处理有序
        if (
          moduleEntries.indexOf([moduleName, chunks]) <
          moduleEntries.length - 1
        ) {
          // 如果不是最后一个模块，添加延迟
          console.log(`⏳ 等待片刻后开始处理下一个模块...`);
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      } catch (error) {
        console.warn(
          `⚠️ 生成模块 ${moduleName} 总结过程出错:`,
          error instanceof Error ? error.message : String(error),
        );
        console.log(`🏗️ 模块 ${moduleName}: 包含 ${chunks.length} 个代码片段`);
      }
    }

    // 处理所有模块的总结
    if (allModulesSummaries.length > 0) {
      await this.processAllModulesSummaries(allModulesSummaries);
    }

    console.log("📊 所有模块总结生成完成");
  }

  /**
   * 处理所有模块的总结，结合已有内容生成更全面的总结
   * @param modulesSummaries 所有模块的总结
   */
  private async processAllModulesSummaries(
    modulesSummaries: { moduleName: string; summary: string }[],
  ): Promise<void> {
    try {
      console.log("🔄 开始处理所有模块总结...");

      // 检查LLM是否可用
      if (!this.llm) {
        console.warn("LLM不可用，无法处理所有模块总结");
        return;
      }

      // 获取工作区目录
      const workspaceDirs = await this.ide.getWorkspaceDirs();
      if (workspaceDirs.length === 0) {
        console.warn("未找到工作区目录，无法读取 TA+3牛码.md");
        return;
      }

      const rootDir = workspaceDirs[0];
      const newCoderPath = path.join(
        localPathOrUriToPath(rootDir),
        "TA+3牛码.md",
      );
      const newCoderUri = `file://${newCoderPath.replace(/\\/g, "/")}`;

      // 读取已有的 TA+3牛码.md 内容
      let existingContent = "";
      if (await this.ide.fileExists(newCoderUri)) {
        existingContent = await this.ide.readFile(newCoderUri);
      }

      // 构建所有模块总结的描述
      const modulesSummariesDescription = modulesSummaries
        .map(({ moduleName, summary }) => `### ${moduleName}\n${summary}\n`)
        .join("\n");

      const userContent = `项目中已有的 TA+3牛码.md 内容:
${existingContent || "无"}

基于代码分析新生成的模块总结:
${modulesSummariesDescription}

请结合已有的内容和新生成的模块总结，生成一个完整的架构分析部分。
要求:
1. 保留已有内容中有价值的信息
2. 补充新生成的模块总结
3. 确保内容结构清晰，模块组织合理
4. 输出格式应符合 Markdown 规范`;

      // 创建带超时的 AbortController
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => {
        abortController.abort();
      }, 30000); // 30秒超时

      const messages: ChatMessage[] = [
        {
          role: "system",
          content: `你是一个技术文档专家，擅长整理和优化项目架构文档。
请结合已有的文档内容和新生成的模块总结，生成一个完整的架构分析部分。
输出应该只包含架构分析部分的内容，不要包含其他部分。`,
        },
        { role: "user", content: userContent },
      ];

      const response = await this.llm.chat(messages, abortController.signal, {
        temperature: 0.0,
        maxTokens: 4096,
      });

      clearTimeout(timeoutId);

      const content = response.content;
      if (typeof content === "string") {
        // 更新 TA+3牛码.md 文件
        await this.updateNewCoderMdCompletely(existingContent, content);

        console.log("✅ 所有模块总结处理完成并更新到 TA+3牛码.md");
      }
    } catch (error) {
      console.warn(
        "⚠️ 处理所有模块总结失败:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * 完整更新 TA+3牛码.md 文件
   * @param existingContent 原有内容
   * @param newArchitectureContent 新的架构分析内容
   */
  private async updateNewCoderMdCompletely(
    existingContent: string,
    newArchitectureContent: string,
  ): Promise<void> {
    try {
      // 获取工作区目录
      const workspaceDirs = await this.ide.getWorkspaceDirs();
      if (workspaceDirs.length === 0) {
        console.warn("未找到工作区目录，无法更新 TA+3牛码.md");
        return;
      }

      const rootDir = workspaceDirs[0];
      const newCoderPath = path.join(
        localPathOrUriToPath(rootDir),
        "TA+3牛码.md",
      );
      const newCoderUri = `file://${newCoderPath.replace(/\\/g, "/")}`;

      let updatedContent = existingContent;

      // 查找架构分析部分
      const architectureSectionRegex =
        /##\s*🏗️\s*架构分析\s*([\s\S]*?)(?=##|$)/i;
      const architectureMatch = updatedContent.match(architectureSectionRegex);

      if (architectureMatch) {
        // 架构分析部分存在，替换内容
        updatedContent = updatedContent.replace(
          architectureSectionRegex,
          `## 🏗️ 架构分析\n${newArchitectureContent}\n`,
        );
      } else {
        // 架构分析部分不存在，添加新的架构分析部分
        updatedContent += `\n\n## 🏗️ 架构分析\n${newArchitectureContent}\n`;
      }

      // 写入更新后的内容
      await this.ide.writeFile(newCoderUri, updatedContent);
      console.log("✅ 已更新 TA+3牛码.md 中的架构分析部分");
    } catch (error) {
      console.warn(
        "⚠️ 更新 TA+3牛码.md 文件失败:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * 生成并输出代码总结到日志（异步执行，不阻塞主流程）
   * 注意：这个方法主要用于备选方案，因为正常流程中代码总结已经在 processModuleChunks 中完成
   * @param chunks 代码片段数组
   * @param userRequest 用户请求
   */
  private generateAndLogSummaries(
    chunks: ScoredChunk[],
    userRequest: string,
  ): void {
    if (!this.llm || chunks.length === 0) {
      return;
    }

    // 异步执行，不阻塞主流程
    Promise.resolve().then(async () => {
      try {
        // 生成代码片段总结并输出到日志
        await this.logCodeSummaries(chunks);

        // 按模块分组代码片段
        const moduleChunks = new Map<string, ScoredChunk[]>();
        for (const chunk of chunks) {
          const module = chunk.module || "未知模块";
          if (!moduleChunks.has(module)) {
            moduleChunks.set(module, []);
          }
          moduleChunks.get(module)!.push(chunk);
        }

        // 生成模块总结并输出到日志
        await this.logModuleSummaries(moduleChunks);
      } catch (error) {
        console.warn(
          "⚠️ 备选方案总结生成过程出错:",
          error instanceof Error ? error.message : String(error),
        );
      }
    });
  }
}
