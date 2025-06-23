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
}

export interface RelevanceScore {
  file: string;
  start_line: number;
  score: number;
}

export interface RelevanceEvaluationResult {
  scores: RelevanceScore[];
}

export class CodeSnippetAnalyzer {
  private maxChunkSize: number;
  private systemPrompt: string;

  constructor(
    private ide: IDE,
    private llm?: ILLM,
    maxChunkSize: number = 2000,
  ) {
    this.maxChunkSize = maxChunkSize;
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

    try {
      const messages: ChatMessage[] = [
        {
          role: "system",
          content: this.systemPrompt.replace("{user_request}", userRequest),
        },
        { role: "user", content: userContent },
      ];

      const response = await this.llm.chat(
        messages,
        new AbortController().signal,
        {
          temperature: 0.0,
          maxTokens: 2000,
        },
      );

      const content = response.content;
      const result = JSON.parse(<string>content) as RelevanceEvaluationResult;

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
      console.error(`LLM API 错误: ${error}`);
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
   */
  async getRelevantSnippets(
    modules: string[],
    files: string[],
    userRequest: string,
    topN: number = 5,
    batchSize: number = 10,
  ): Promise<ScoredChunk[]> {
    if (!modules.length || !files.length || !userRequest) {
      throw new Error("模块、文件和用户请求必须提供且非空");
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

    // 并发收集所有代码块
    const allChunks: CodeChunk[] = [];
    const tasks: Promise<CodeChunk[]>[] = [];

    for (const module of modules) {
      const modulePath = path.join(normalizedBasePath, module);
      for (const file of files) {
        const filePath = path.join(modulePath, file);
        const fileUri = this.safePathToUri(filePath);

        // 检查文件是否存在
        if (await this.ide.fileExists(fileUri)) {
          tasks.push(this.readFileChunks(filePath));
        } else {
          console.warn(`文件 ${filePath} 不存在，跳过`);
        }
      }
    }

    const chunkLists = await Promise.allSettled(tasks);
    for (const result of chunkLists) {
      if (result.status === "fulfilled") {
        allChunks.push(...result.value);
      } else {
        console.error(`读取文件错误: ${result.reason}`);
      }
    }

    if (!allChunks.length) {
      console.warn("未找到有效的代码块");
      return [];
    }

    // 分批处理代码块
    const scoredChunks: RelevanceScore[] = [];
    const batchTasks: Promise<RelevanceScore[]>[] = [];

    for (let i = 0; i < allChunks.length; i += batchSize) {
      const batch = allChunks.slice(i, i + batchSize);
      batchTasks.push(this.evaluateRelevance(userRequest, batch));
    }

    const batchResults = await Promise.allSettled(batchTasks);
    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        scoredChunks.push(...result.value);
      } else {
        console.error(`评估批次错误: ${result.reason}`);
      }
    }

    // 排序并选择前N个
    const sortedChunks = scoredChunks
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);

    // 构建结果
    const results: ScoredChunk[] = [];
    for (const chunk of sortedChunks) {
      for (const origChunk of allChunks) {
        if (
          origChunk.file_path === chunk.file &&
          origChunk.start_line === chunk.start_line
        ) {
          results.push({
            file: chunk.file,
            start_line: chunk.start_line,
            score: chunk.score,
            code: origChunk.chunk,
          });
          break;
        }
      }
    }

    return results;
  }
}
