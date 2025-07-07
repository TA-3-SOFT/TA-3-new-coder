import * as path from "node:path";
import { IDE, ILLM, ChatMessage } from "../index.js";
import { localPathToUri, localPathOrUriToPath } from "./pathToUri.js";

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

export interface RelevanceEvaluationResult {
  scores: RelevanceScore[];
}

export interface ModuleFileMap {
  [moduleName: string]: string[];
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
  private concurrencyManager: ConcurrencyManager;

  constructor(
    protected ide: IDE,
    protected llm?: ILLM,
    maxChunkSize: number = 2000,
    maxConcurrency: number = 4,
  ) {
    this.maxChunkSize = maxChunkSize;
    this.concurrencyManager = new ConcurrencyManager(maxConcurrency);
    this.systemPrompt = `
        You are a senior code analysis expert specializing in Java and Spring framework projects. Your task is to evaluate code snippets for relevance to a user requirement. Follow these steps:

        1. Analyze the user requirement: "{user_request}"
        2. Break down the requirement into key components (e.g., functionality, variables, configuration).
        3. Evaluate each code snippet based on the following criteria (0-10 score, 10=most relevant):
           - Presence of relevant functionality (e.g., methods or classes implementing the requested feature).
           - Presence of relevant configuration or constants (e.g., cache prefix settings).
           - Relevant keywords or variable names matching the requirement.
           - Comments or documentation related to the requirement.
           - Penalize snippets that are unrelated or contain only generic code (e.g., imports, boilerplate).
        4. Consider the project context: This is a Java-based Spring framework project focused on cache management.
        5. Return JSON: {{"scores": [{{"file": "path", "start_line": number, "score": number}}]}}
           w- IMPORTANT: Return ONLY pure JSON text without any markdown formatting (no \`\`\`json code blocks). The response must be valid JSON that can be directly parsed.
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
      console.error(`读取文件 ${filePath} 失败: ${error}`);
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
      const messages: ChatMessage[] = [
        {
          role: "system",
          content: this.systemPrompt.replace("{user_request}", userRequest),
        },
        { role: "user", content: userContent },
      ];

      const response = await this.llm.chat(messages, abortController.signal, {
        temperature: 0.0,
        maxTokens: 2000,
      });

      clearTimeout(timeoutId);

      const content = response.content;
      if (!content || typeof content !== "string") {
        throw new Error("LLM 返回内容为空或格式错误");
      }

      // 尝试解析 JSON，添加更好的错误处理
      let result: RelevanceEvaluationResult;
      try {
        result = JSON.parse(content) as RelevanceEvaluationResult;
      } catch (parseError) {
        console.error("JSON 解析失败，原始内容:", content.substring(0, 500));
        throw new Error(`JSON 解析失败: ${parseError}`);
      }

      // 标准化分数
      const scores = result.scores || [];
      if (scores.length > 0) {
        const maxScore = Math.max(...scores.map((s) => s.score));
        if (maxScore > 0) {
          scores.forEach((s) => {
            s.score = (s.score / maxScore) * 10; // 标准化到 0-10
          });
        }
      }

      return scores;
    } catch (error) {
      clearTimeout(timeoutId);
      console.error(`LLM API 错误: ${error}`);

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

    console.log(moduleFileMap);
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
    console.log(`等待 ${moduleTasks.length} 个模块的并发处理...`);
    const moduleTaskResults = await Promise.allSettled(moduleTasks);

    let successModules = 0;
    let errorModules = 0;

    for (const result of moduleTaskResults) {
      if (result.status === "fulfilled") {
        moduleResults.push(...result.value);
        successModules++;
      } else {
        console.error(`模块处理失败: ${result.reason}`);
        errorModules++;
      }
    }

    // 显示并发管理器统计信息
    const stats = this.concurrencyManager.getStats();
    console.log(
      `处理完成: 成功模块 ${successModules}, 失败模块 ${errorModules}, 总代码片段 ${moduleResults.length}`,
    );
    console.log(`并发统计:`, stats);

    return moduleResults;
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
    console.log(`开始处理模块: ${moduleName}, 文件数: ${files.length}`);

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

    console.log(`模块 ${moduleName} 共收集到 ${moduleChunks.length} 个代码块`);

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
            `模块 ${moduleName} 第 ${batchIndex} 批处理失败: ${error}`,
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

    console.log(
      `模块 ${moduleName} 批次处理完成: 成功 ${successBatches}, 失败 ${errorBatches}`,
    );

    // 排序并选择该模块的前N个
    const sortedChunks = moduleScores
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);

    // 构建该模块的结果
    const moduleResults: ScoredChunk[] = [];
    for (const chunk of sortedChunks) {
      for (const origChunk of moduleChunks) {
        if (
          origChunk.file_path === chunk.file &&
          origChunk.start_line === chunk.start_line
        ) {
          moduleResults.push({
            file: chunk.file,
            start_line: chunk.start_line,
            score: chunk.score,
            code: origChunk.chunk,
            module: moduleName, // 添加模块信息
          });
          break;
        }
      }
    }

    console.log(`模块 ${moduleName} 返回 ${moduleResults.length} 个代码片段`);
    return moduleResults;
  }
}
