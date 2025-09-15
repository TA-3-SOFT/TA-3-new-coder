import * as path from "node:path";
import { IDE, ILLM, ChatMessage } from "../index.js";
import { localPathToUri, localPathOrUriToPath } from "./pathToUri.js";
import { getNewCoderMdFile } from "../config/loadLocalAssistants.js";

// 按照原始Python代码的接口定义
export interface ModuleInfo {
  path: string;
  pom_location: string;
  description: string;
  submodules: ModuleInfo[];
}

export interface ProjectStructure {
  modules: ModuleInfo;
}

export interface FlatModule {
  name: string;
  description: string;
}

export interface ModuleRecommendationResult {
  recommended_modules: string[];
  reasoning: string;
}

export interface FileAnalysisResult {
  recommended_files: string[];
  reasoning: string;
}

export interface ModuleAndFileRecommendationResult {
  recommended_modules: string[];
  module_reasoning: string;
  recommended_files: Array<{
    module: string;
    files: string[];
    file_reasoning: string;
  }>;
}

// 配置区域 (按照原始Python代码)
const README_FILES = ["README.md", "README.txt", "README"];
const MAX_README_CHARS = 2000;

// 允许的文件扩展名 (按照原始Python代码)
const ALLOWED_EXTENSIONS = new Set([
  ".java",
  ".yml",
  ".yaml",
  ".xml",
  ".properties",
  ".json",
]);

// 忽略模式 (按照原始Python代码)
const IGNORE_PATTERNS = ["target/", "node_modules", ".git", ".idea", ".vscode"];

export class ProjectAnalyzer {
  // 简单的路径映射缓存
  private modulePathMap: Map<number, string> = new Map();
  private filePathMap: Map<number, string> = new Map();

  constructor(
    private ide: IDE,
    private llm?: ILLM,
  ) {}

  /**
   * 清理和修复不完整的 XML 响应
   */
  private cleanXmlResponse(
    content: string,
    defaultReasoning: string = "Analysis completed.",
    responseType: "module" | "file" = "module",
  ): string {
    try {
      // 尝试解析 XML
      const testResult = this.parseXmlToObject(content, responseType);

      // 检查解析结果是否有效
      const hasValidContent =
        responseType === "module"
          ? (testResult as ModuleRecommendationResult).recommended_modules
              .length > 0
          : (testResult as FileAnalysisResult).recommended_files.length > 0;

      if (hasValidContent) {
        return content; // XML 已经完整，直接返回
      } else {
        throw new Error("解析结果为空，需要修复");
      }
    } catch (parseError) {
      console.warn(
        `⚠️ [ProjectAnalyzer] XML 解析失败，尝试修复: ${parseError}`,
      );

      let cleanedContent = content.trim();

      // 确保有根标签
      if (!cleanedContent.includes("<response>")) {
        cleanedContent = `<response>\n${cleanedContent}\n</response>`;
      }

      cleanedContent = this.fixUnclosedXmlTags(
        cleanedContent,
        responseType,
        defaultReasoning,
      );

      // 再次验证修复后的 XML
      try {
        this.parseXmlToObject(cleanedContent, responseType);
        return cleanedContent;
      } catch (secondError) {
        console.error(
          `❌ [ProjectAnalyzer] XML 修复失败，使用默认响应: ${secondError}`,
        );
        const defaultResponse = this.createDefaultXmlResponse(
          responseType,
          defaultReasoning,
        );
        return defaultResponse;
      }
    }
  }

  /**
   * 修复未闭合的 XML 标签
   */
  private fixUnclosedXmlTags(
    content: string,
    responseType: "module" | "file",
    defaultReasoning: string,
  ): string {
    let fixed = content;

    // 修复常见的不完整标签问题
    // 1. 修复截断的 <file> 标签（如 <file>path</file 或 <file>path</ 或 <file>path</）
    const fileTagPattern = /<file>[^<]*<\/(?!file>)/g;
    if (fileTagPattern.test(fixed)) {
      fixed = fixed.replace(/<file>([^<]*)<\/(?!file>).*$/g, "<file>$1</file>");
    }

    // 2. 修复截断的最后一个 <file> 标签（如 <file>path</）
    const lastIncompleteFile = fixed.match(/<file>[^<]*<\/?\s*$/);
    if (lastIncompleteFile) {
      const beforeIncomplete = fixed.substring(0, fixed.lastIndexOf("<file>"));
      const fileContent = fixed.substring(fixed.lastIndexOf("<file>") + 6);
      const cleanContent = fileContent.replace(/<\/?\s*$/, "");
      if (cleanContent.trim()) {
        fixed = beforeIncomplete + `<file>${cleanContent}</file>`;
      } else {
        fixed = beforeIncomplete.trim();
      }
    }

    // 3. 修复 </recommended_files 缺少 >
    if (
      fixed.includes("</recommended_files") &&
      !fixed.includes("</recommended_files>")
    ) {
      fixed = fixed.replace("</recommended_files", "</recommended_files>");
    }

    // 4. 修复 </recommended_modules 缺少 >
    if (
      fixed.includes("</recommended_modules") &&
      !fixed.includes("</recommended_modules>")
    ) {
      fixed = fixed.replace("</recommended_modules", "</recommended_modules>");
    }

    // 确保有完整的根标签
    if (!fixed.includes("</response>")) {
      if (!fixed.includes("<response>")) {
        fixed = `<response>\n${fixed}\n</response>`;
      } else {
        fixed = fixed + "\n</response>";
      }
    }

    // 根据响应类型修复特定标签
    if (responseType === "module") {
      // 修复模块推荐相关标签
      if (
        fixed.includes("<recommended_modules>") &&
        !fixed.includes("</recommended_modules>")
      ) {
        // 找到最后一个 <module> 标签的位置，在其后添加结束标签
        const lastModuleEnd = fixed.lastIndexOf("</module>");
        if (lastModuleEnd !== -1) {
          const beforeEnd = fixed.substring(
            0,
            lastModuleEnd + "</module>".length,
          );
          const afterEnd = fixed.substring(lastModuleEnd + "</module>".length);
          fixed = beforeEnd + "\n</recommended_modules>" + afterEnd;
        } else {
          // 如果没有找到 module 标签，直接闭合
          fixed = fixed.replace(
            "<recommended_modules>",
            "<recommended_modules>\n</recommended_modules>",
          );
        }
      }

      // 确保有必需的标签
      if (!fixed.includes("<recommended_modules>")) {
        fixed = fixed.replace(
          "</response>",
          `<recommended_modules></recommended_modules>\n<reasoning>${defaultReasoning}</reasoning>\n</response>`,
        );
      }
    } else {
      // 修复文件分析相关标签
      if (
        fixed.includes("<recommended_files>") &&
        !fixed.includes("</recommended_files>")
      ) {
        // 找到最后一个 <file> 标签的位置，在其后添加结束标签
        const lastFileEnd = fixed.lastIndexOf("</file>");
        if (lastFileEnd !== -1) {
          const beforeEnd = fixed.substring(0, lastFileEnd + "</file>".length);
          const afterEnd = fixed.substring(lastFileEnd + "</file>".length);
          fixed = beforeEnd + "\n</recommended_files>" + afterEnd;
        } else {
          // 如果没有找到 file 标签，直接闭合
          fixed = fixed.replace(
            "<recommended_files>",
            "<recommended_files>\n</recommended_files>",
          );
        }
      }

      // 确保有必需的标签
      if (!fixed.includes("<recommended_files>")) {
        fixed = fixed.replace(
          "</response>",
          `<recommended_files></recommended_files>\n<reasoning>${defaultReasoning}</reasoning>\n</response>`,
        );
      }
    }

    // 添加缺失的 reasoning 标签
    if (!fixed.includes("<reasoning>")) {
      fixed = fixed.replace(
        "</response>",
        `<reasoning>${defaultReasoning}</reasoning>\n</response>`,
      );
    }

    // 修复未闭合的 reasoning 标签
    if (fixed.includes("<reasoning>") && !fixed.includes("</reasoning>")) {
      const reasoningStart = fixed.indexOf("<reasoning>");
      const beforeReasoning = fixed.substring(0, reasoningStart);
      fixed =
        beforeReasoning +
        `<reasoning>${defaultReasoning}</reasoning>\n</response>`;
    }

    return fixed;
  }

  /**
   * 创建默认的 XML 响应
   */
  private createDefaultXmlResponse(
    responseType: "module" | "file",
    defaultReasoning: string,
  ): string {
    if (responseType === "module") {
      return `<response>
<recommended_modules></recommended_modules>
<reasoning>${defaultReasoning}</reasoning>
</response>`;
    } else {
      return `<response>
<recommended_files></recommended_files>
<reasoning>${defaultReasoning}</reasoning>
</response>`;
    }
  }

  /**
   * 解析 XML 内容为对象
   */
  private parseXmlToObject(
    xmlContent: string,
    responseType: "module" | "file",
  ): ModuleRecommendationResult | FileAnalysisResult {
    // 简单的 XML 解析实现
    const extractTagContent = (xml: string, tagName: string): string => {
      const startTag = `<${tagName}>`;
      const endTag = `</${tagName}>`;
      const startIndex = xml.indexOf(startTag);
      const endIndex = xml.indexOf(endTag);

      if (startIndex === -1 || endIndex === -1) {
        console.warn(
          `⚠️ [ProjectAnalyzer] 标签 ${tagName} 未找到完整的开始或结束标签`,
        );
        return "";
      }

      const content = xml
        .substring(startIndex + startTag.length, endIndex)
        .trim();
      return content;
    };

    const extractListItems = (
      xml: string,
      containerTag: string,
      itemTag: string,
    ): string[] => {
      const containerContent = extractTagContent(xml, containerTag);
      if (!containerContent) {
        console.warn(`⚠️ [ProjectAnalyzer] 容器 ${containerTag} 为空`);
        return [];
      }

      const items: string[] = [];
      const startTag = `<${itemTag}>`;
      const endTag = `</${itemTag}>`;

      let searchStart = 0;
      let itemCount = 0;
      while (true) {
        const startIndex = containerContent.indexOf(startTag, searchStart);
        if (startIndex === -1) break;

        const endIndex = containerContent.indexOf(endTag, startIndex);
        if (endIndex === -1) break;

        const item = containerContent
          .substring(startIndex + startTag.length, endIndex)
          .trim();
        if (item) {
          items.push(item);
          itemCount++;
        }

        searchStart = endIndex + endTag.length;
      }

      return items;
    };

    try {
      const reasoning = extractTagContent(xmlContent, "reasoning");

      if (responseType === "module") {
        const modules = extractListItems(
          xmlContent,
          "recommended_modules",
          "module",
        );
        const result = {
          recommended_modules: modules,
          reasoning:
            reasoning || "Modules selected based on requirement analysis.",
        } as ModuleRecommendationResult;
        return result;
      } else {
        const files = extractListItems(xmlContent, "recommended_files", "file");
        const result = {
          recommended_files: files,
          reasoning:
            reasoning || "Files selected based on requirement analysis.",
        } as FileAnalysisResult;
        return result;
      }
    } catch (error) {
      console.error(`❌ [ProjectAnalyzer] XML 解析过程中出错: ${error}`);
      throw new Error(`XML 解析失败: ${error}`);
    }
  }

  /**
   * 验证 XML 格式是否正确
   */
  private validateXmlFormat(
    xmlContent: string,
    responseType: "module" | "file",
  ): boolean {
    try {
      // 基本的 XML 结构验证
      if (
        !xmlContent.includes("<response>") ||
        !xmlContent.includes("</response>")
      ) {
        return false;
      }

      if (responseType === "module") {
        return (
          xmlContent.includes("<recommended_modules>") &&
          xmlContent.includes("</recommended_modules>") &&
          xmlContent.includes("<reasoning>") &&
          xmlContent.includes("</reasoning>")
        );
      } else {
        return (
          xmlContent.includes("<recommended_files>") &&
          xmlContent.includes("</recommended_files>") &&
          xmlContent.includes("<reasoning>") &&
          xmlContent.includes("</reasoning>")
        );
      }
    } catch (error) {
      return false;
    }
  }

  /**
   * 带重试机制的 LLM 调用
   */
  private async callLLMWithRetry(
    messages: ChatMessage[],
    maxRetries: number = 2,
    responseType: "module" | "file" = "module",
  ): Promise<ModuleRecommendationResult | FileAnalysisResult> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (!this.llm) {
          throw new Error("LLM not available");
        }

        const response = await this.llm.chat(
          messages,
          new AbortController().signal,
          {
            temperature: 0.1,
            maxTokens: 1000,
          },
        );

        const content = response.content;

        // 清理和修复 XML 内容
        const cleanedContent = this.cleanXmlResponse(
          <string>content,
          responseType === "module"
            ? "Modules selected based on requirement analysis."
            : "Files selected based on requirement analysis.",
          responseType,
        );

        // 解析 XML 内容
        const result = this.parseXmlToObject(cleanedContent, responseType);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.warn(
          `⚠️ [ProjectAnalyzer] LLM 调用尝试 ${attempt + 1} 失败: ${lastError.message}`,
        );

        // 如果不是最后一次尝试，等待一段时间后重试
        if (attempt < maxRetries) {
          const waitTime = Math.pow(2, attempt) * 1000; // 指数退避
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
      }
    }

    // 所有重试都失败了，返回默认结果
    console.error(`❌ [ProjectAnalyzer] 所有重试都失败，返回默认结果`);
    console.error(`🔍 [ProjectAnalyzer] 最后一个错误:`, lastError);

    if (responseType === "module") {
      return {
        recommended_modules: [],
        reasoning: "由于多次解析错误，无法推荐模块。请检查输入要求或重试。",
      } as ModuleRecommendationResult;
    } else {
      return {
        recommended_files: [],
        reasoning: "由于多次解析错误，无法推荐文件。请检查输入要求或重试。",
      } as FileAnalysisResult;
    }
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
   * 解析pom.xml文件，提取模块信息 (对应Python的parse_pom函数)
   */
  async parsePom(pomPath: string): Promise<string[]> {
    const modules: string[] = [];
    try {
      const pomContent = await this.ide.readFile(pomPath);

      // 简化的XML解析，查找<module>标签
      const moduleRegex = /<module>\s*([^<]+)\s*<\/module>/g;
      let match;
      while ((match = moduleRegex.exec(pomContent)) !== null) {
        const moduleName = match[1].trim();
        if (moduleName) {
          modules.push(moduleName);
        }
      }
    } catch (error) {
      console.warn(`警告: 解析 ${pomPath} 失败: ${error}`);
    }
    return modules;
  }

  /**
   * 从README文件中提取模块描述信息 (对应Python的extract_readme_info函数)
   */
  async extractReadmeInfo(modulePath: string): Promise<string> {
    for (const file of README_FILES) {
      const readmePath = path.join(modulePath, file);
      const readmeUri = this.safePathToUri(readmePath);

      try {
        if (await this.ide.fileExists(readmeUri)) {
          const content = await this.ide.readFile(readmeUri);
          return content.substring(0, MAX_README_CHARS);
        }
      } catch (error) {
        console.warn(`警告: 读取 ${readmePath} 失败: ${error}`);
      }
    }
    return "未找到README文件";
  }

  /**
   * 递归构建模块树结构 (对应Python的build_module_tree函数)
   */
  async buildModuleTree(
    rootDir: string,
    currentPath: string = "",
  ): Promise<ModuleInfo | null> {
    const currentDir = currentPath ? path.join(rootDir, currentPath) : rootDir;
    const pomPath = path.join(currentDir, "pom.xml");
    const pomUri = this.safePathToUri(pomPath);

    if (!(await this.ide.fileExists(pomUri))) {
      return null;
    }

    const moduleInfo: ModuleInfo = {
      path: currentPath || "ROOT",
      pom_location: currentPath ? path.join(currentPath, "pom.xml") : "pom.xml",
      description: await this.extractReadmeInfo(currentDir),
      submodules: [],
    };

    // 获取并处理子模块
    const modules = await this.parsePom(pomUri);
    for (const module of modules) {
      const moduleRelPath = currentPath
        ? path.join(currentPath, module)
        : module;
      const submodule = await this.buildModuleTree(rootDir, moduleRelPath);
      if (submodule) {
        moduleInfo.submodules.push(submodule);
      }
    }

    return moduleInfo;
  }

  /**
   * 分析Maven项目并生成结构报告 (对应Python的analyze_maven_project函数)
   */
  async analyzeMavenProject(
    projectRoot: string,
  ): Promise<ProjectStructure | null> {
    // 确保 projectRoot 是本地路径而不是 URI
    const normalizedProjectRoot = projectRoot.startsWith("file://")
      ? localPathOrUriToPath(projectRoot)
      : projectRoot;

    // 验证项目根目录
    const rootPom = path.join(normalizedProjectRoot, "pom.xml");
    const rootPomUri = this.safePathToUri(rootPom);

    if (!(await this.ide.fileExists(rootPomUri))) {
      console.error(`错误: 在 ${normalizedProjectRoot} 中未找到pom.xml`);
      return null;
    }

    const projectStructure = await this.buildModuleTree(normalizedProjectRoot);

    if (projectStructure) {
      return { modules: projectStructure };
    }

    return null;
  }

  /**
   * 递归展平模块树，仅收集叶子模块（无子模块）的path和description (对应Python的flatten_modules函数)
   */
  flattenModules(
    module: ModuleInfo,
    moduleList: FlatModule[] = [],
  ): FlatModule[] {
    // 检查是否包含 path 字段
    if (!module.path) {
      console.warn(
        `警告: 模块缺少 'path' 字段，跳过此模块: ${JSON.stringify(module)}`,
      );
      return moduleList;
    }

    // 仅当 submodules 为空时添加模块（叶子模块）
    if (!module.submodules || module.submodules.length === 0) {
      moduleList.push({
        name: module.path,
        description: module.description || "无描述",
      });
    }

    // 递归处理子模块
    for (const submodule of module.submodules || []) {
      this.flattenModules(submodule, moduleList);
    }

    return moduleList;
  }

  /**
   * 加载模块信息并展平 (对应Python的load_module_info函数)
   */
  async loadModuleInfo(
    projectStructure: ProjectStructure,
  ): Promise<FlatModule[]> {
    if (!projectStructure.modules) {
      throw new Error("项目结构缺少 'modules' 键");
    }

    return this.flattenModules(projectStructure.modules);
  }

  /**
   * 加载项目根目录下的 .gitignore 文件，解析忽略模式 (对应Python的load_gitignore_patterns函数)
   */
  async loadGitignorePatterns(rootDir: string): Promise<string[]> {
    // 确保 rootDir 是本地路径而不是 URI
    const normalizedRootDir = rootDir.startsWith("file://")
      ? localPathOrUriToPath(rootDir)
      : rootDir;

    const gitignorePath = path.join(normalizedRootDir, ".gitignore");
    const gitignoreUri = this.safePathToUri(gitignorePath);
    const patterns: string[] = [];

    if (await this.ide.fileExists(gitignoreUri)) {
      try {
        const content = await this.ide.readFile(gitignoreUri);
        const lines = content.split("\n");

        let validPatternCount = 0;
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (trimmedLine && !trimmedLine.startsWith("#")) {
            patterns.push(trimmedLine);
            validPatternCount++;
          }
        }
      } catch (error) {
        console.error(
          `❌ [ProjectAnalyzer] 无法读取 .gitignore 文件 ${gitignorePath}: ${error}`,
        );
      }
    } else {
      console.log(`⚠️ [ProjectAnalyzer] 未找到 .gitignore 文件`);
    }

    // 明确添加 target/ 到忽略模式
    patterns.push("target/");
    return patterns;
  }

  /**
   * 检查文件或目录是否应被 .gitignore 或 target/ 忽略 (对应Python的should_ignore函数)
   */
  shouldIgnore(filePath: string, rootDir: string, patterns: string[]): boolean {
    const relPath = path.relative(rootDir, filePath).replace(/\\/g, "/");

    for (const pattern of patterns) {
      // 简化的模式匹配
      if (
        relPath.includes(pattern) ||
        path.basename(filePath) === pattern.replace("/", "")
      ) {
        return true;
      }
      // 额外检查是否在 target/ 目录下
      if (
        relPath.startsWith("target/") ||
        path.basename(filePath) === "target"
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * 获取模块的文件列表，排除 .gitignore 和 target/ 忽略的文件，仅列出文件 (对应Python的get_directory_tree函数)
   */
  async getDirectoryTree(modulePath: string, rootDir: string): Promise<string> {
    // 确保 rootDir 是本地路径而不是 URI
    const normalizedRootDir = rootDir.startsWith("file://")
      ? localPathOrUriToPath(rootDir)
      : rootDir;

    const moduleDir = path.join(
      normalizedRootDir,
      modulePath.replace(/\\/g, path.sep),
    );
    const moduleDirUri = this.safePathToUri(moduleDir);

    if (!(await this.ide.fileExists(moduleDirUri))) {
      console.warn(`⚠️ [ProjectAnalyzer] 模块目录不存在: ${moduleDir}`);
      return "";
    }

    // 加载 .gitignore 模式
    const gitignorePatterns =
      await this.loadGitignorePatterns(normalizedRootDir);

    // 递归收集所有文件
    const collectFiles = async (directory: string): Promise<string[]> => {
      const files: string[] = [];
      try {
        const dirUri = this.safePathToUri(directory);
        const entries = await this.ide.listDir(dirUri);

        let ignoredCount = 0;
        let fileCount = 0;
        let dirCount = 0;
        let allowedFileCount = 0;

        for (const [entryName, fileType] of entries.sort()) {
          const entryPath = path.join(directory, entryName);

          if (
            this.shouldIgnore(entryPath, normalizedRootDir, gitignorePatterns)
          ) {
            ignoredCount++;
            continue;
          }

          if (fileType === 1) {
            // File
            fileCount++;
            const ext = path.extname(entryName).toLowerCase();

            if (ALLOWED_EXTENSIONS.has(ext)) {
              allowedFileCount++;
              const relPath = path
                .relative(moduleDir, entryPath)
                .replace(/\\/g, "/");
              files.push(relPath);
            } else {
              console.log(
                `❌ [ProjectAnalyzer] 跳过文件: ${entryName} (扩展名不在允许列表中)`,
              );
            }
          } else if (fileType === 2) {
            // Directory
            dirCount++;
            const subFiles = await collectFiles(entryPath);
            files.push(...subFiles);
          }
        }
      } catch (error) {
        console.error(
          `❌ [ProjectAnalyzer] 无法访问目录 ${directory}: ${error}`,
        );
      }
      return files;
    };

    const files = await collectFiles(moduleDir);

    if (files.length === 0) {
      console.warn(
        `⚠️ [ProjectAnalyzer] 模块 ${modulePath} 没有找到任何符合条件的文件`,
      );
    }

    const result = files.join("\n");
    return result;
  }

  /**
   * 标准化模块路径，确保路径格式一致
   */
  private normalizeModulePath(modulePath: string): string {
    // 移除前后空白字符
    let normalized = modulePath.trim();

    // 统一使用正斜杠作为路径分隔符
    normalized = normalized.replace(/\\/g, "/");

    // 移除开头的 "./"
    if (normalized.startsWith("./")) {
      normalized = normalized.substring(2);
    }

    // 移除开头和结尾的斜杠
    normalized = normalized.replace(/^\/+|\/+$/g, "");

    return normalized;
  }

  /**
   * 计算两个路径的相似度
   */
  private calculatePathSimilarity(path1: string, path2: string): number {
    const parts1 = path1.split("/");
    const parts2 = path2.split("/");
    const maxLength = Math.max(parts1.length, parts2.length);

    let matches = 0;
    for (let i = 0; i < maxLength; i++) {
      if (parts1[i] === parts2[i]) {
        matches++;
      }
    }

    return matches / maxLength;
  }

  /**
   * 提取路径中的模块名（最后一个路径段）
   */
  private extractModuleName(modulePath: string): string {
    const normalizedPath = this.normalizeModulePath(modulePath);
    const parts = normalizedPath.split("/");
    return parts[parts.length - 1] || normalizedPath;
  }

  /**
   * 标准化模块名，用于比较
   */
  private normalizeModuleName(moduleName: string): string {
    return moduleName
      .toLowerCase()
      .replace(/[-_]/g, "") // 移除连字符和下划线
      .replace(/\s+/g, ""); // 移除空格
  }

  /**
   * 检查两个模块名是否匹配（考虑各种变体）
   */
  private isModuleNameMatch(name1: string, name2: string): boolean {
    const normalized1 = this.normalizeModuleName(name1);
    const normalized2 = this.normalizeModuleName(name2);

    // 精确匹配
    if (normalized1 === normalized2) {
      return true;
    }

    // 检查是否一个包含另一个
    if (
      normalized1.includes(normalized2) ||
      normalized2.includes(normalized1)
    ) {
      return true;
    }

    return false;
  }

  /**
   * 验证模块路径是否存在于项目结构中
   */
  private async validateModulePath(
    modulePath: string,
    projectStructure: ProjectStructure,
  ): Promise<string | null> {
    const modules = await this.loadModuleInfo(projectStructure);
    const normalizedPath = this.normalizeModulePath(modulePath);

    // 1. 精确匹配
    const exactMatch = modules.find(
      (m) => this.normalizeModulePath(m.name) === normalizedPath,
    );
    if (exactMatch) {
      return exactMatch.name;
    }

    // 2. 模块名匹配：提取模块名进行匹配
    const inputModuleName = this.extractModuleName(normalizedPath);
    const moduleNameMatches = modules.filter((m) => {
      const moduleNameFromPath = this.extractModuleName(m.name);
      return this.isModuleNameMatch(moduleNameFromPath, inputModuleName);
    });

    if (moduleNameMatches.length === 1) {
      return moduleNameMatches[0].name;
    }

    // 如果有多个模块名匹配，选择路径最相似的
    if (moduleNameMatches.length > 1) {
      const bestMatch = moduleNameMatches.reduce((best, current) => {
        const bestSimilarity = this.calculatePathSimilarity(
          normalizedPath,
          this.normalizeModulePath(best.name),
        );
        const currentSimilarity = this.calculatePathSimilarity(
          normalizedPath,
          this.normalizeModulePath(current.name),
        );
        return currentSimilarity > bestSimilarity ? current : best;
      });
      return bestMatch.name;
    }

    // 3. 部分路径匹配：查找包含该路径的模块
    const partialMatches = modules.filter((m) => {
      const normalizedModuleName = this.normalizeModulePath(m.name);
      return (
        normalizedModuleName.includes(normalizedPath) ||
        normalizedPath.includes(normalizedModuleName)
      );
    });

    if (partialMatches.length === 1) {
      return partialMatches[0].name;
    }

    // 如果有多个部分匹配，选择最相似的
    if (partialMatches.length > 1) {
      const bestMatch = partialMatches.reduce((best, current) => {
        const bestSimilarity = this.calculatePathSimilarity(
          normalizedPath,
          this.normalizeModulePath(best.name),
        );
        const currentSimilarity = this.calculatePathSimilarity(
          normalizedPath,
          this.normalizeModulePath(current.name),
        );
        return currentSimilarity > bestSimilarity ? current : best;
      });
      return bestMatch.name;
    }

    return null;
  }

  /**
   * 根据需求推荐最多五个叶子模块 (对应Python的recommend_modules函数)
   */
  async recommendModules(
    requirement: string,
    projectStructure: ProjectStructure,
  ): Promise<ModuleRecommendationResult> {
    // 加载并展平模块信息（仅叶子模块）
    const modules = await this.loadModuleInfo(projectStructure);

    // 清空并重建模块路径映射
    this.modulePathMap.clear();
    modules.forEach((module, index) => {
      this.modulePathMap.set(index + 1, module.name);
    });

    // 构建带编号的用户消息
    const userMessage = `
**User Requirement:**
${requirement}

**Leaf Modules Information:**
${modules.map((module, index) => `${index + 1}. ${module.name}: ${module.description}`).join("\n")}
`;

    // 调用LLM推荐模块
    if (!this.llm) {
      throw new Error("LLM not available for module recommendation");
    }

    // 尝试加载TA+3牛码.md文件内容
    let newCoderMdContent = "";
    try {
      const newCoderFiles = await getNewCoderMdFile(this.ide);
      if (newCoderFiles.length > 0) {
        newCoderMdContent = newCoderFiles[0].content;
      }
    } catch (error) {
      console.warn("Failed to load TA+3牛码.md:", error);
    }

    try {
      const messages: ChatMessage[] = [
        {
          role: "system",
          content: `${newCoderMdContent ? `**Important Project Information from TA+3牛码.md:**\n${newCoderMdContent}\n\n` : ""}You are an expert in software architecture and module analysis. Given a user requirement and a list of numbered leaf modules (modules with no submodules) with their descriptions, determine which module(s) are most relevant for implementing or modifying code to meet the requirement.

**Instructions:**
- Analyze the requirement and match it to the module descriptions.
- Recommend up to five most relevant leaf module(s) based on functionality.
- If fewer than five leaf modules are relevant, return only those.
- Ensure all recommended modules are leaf modules (no submodules).
- CRITICAL: Return ONLY the numbers of the recommended modules, not the full paths.

**Response Format:**
Return your response in the following XML format:

<response>
<recommended_modules>
<module>1</module>
<module>3</module>
<module>5</module>
</recommended_modules>
<reasoning>Brief explanation of why these modules were chosen</reasoning>
</response>

**IMPORTANT:**
- Return ONLY the XML response without any markdown formatting or code blocks
- The XML must be well-formed and complete
- Each module number must be wrapped in <module></module> tags
- Include reasoning in <reasoning></reasoning> tags
- Do not include any text before or after the XML response`,
        },
        { role: "user", content: userMessage },
      ];

      const result = (await this.callLLMWithRetry(
        messages,
        2,
        "module",
      )) as ModuleRecommendationResult;

      // 将返回的编号转换为模块路径
      if (result.recommended_modules) {
        const validatedModules: string[] = [];

        for (const moduleNumberStr of result.recommended_modules) {
          const moduleNumber = parseInt(moduleNumberStr.trim());
          if (!isNaN(moduleNumber) && this.modulePathMap.has(moduleNumber)) {
            const modulePath = this.modulePathMap.get(moduleNumber)!;
            validatedModules.push(modulePath);
          } else {
            console.warn(`LLM返回的模块编号无效: ${moduleNumberStr}`);
          }
        }

        result.recommended_modules = validatedModules;
      }

      if (result.recommended_modules && result.recommended_modules.length > 5) {
        result.recommended_modules = result.recommended_modules.slice(0, 5);
        result.reasoning +=
          " (Note: Limited to top 5 leaf modules as per requirement.)";
      }

      return result;
    } catch (error) {
      console.error(`❌ [ProjectAnalyzer] recommendModules 方法出错:`);
      console.error(
        `🔍 [ProjectAnalyzer] 错误类型: ${error?.constructor?.name || "Unknown"}`,
      );
      console.error(
        `📝 [ProjectAnalyzer] 错误消息: ${error instanceof Error ? error.message : String(error)}`,
      );

      // 返回空结果作为最终降级方案
      return {
        recommended_modules: [],
        reasoning: "由于系统错误，无法推荐模块。请检查输入要求或重试。",
      } as ModuleRecommendationResult;
    }
  }

  /**
   * 调用LLM分析模块目录树，返回最相关的文件 (对应Python的analyze_files_with_openai函数)
   */
  async analyzeFilesWithLLM(
    requirement: string,
    moduleName: string,
    fileList: string,
  ): Promise<FileAnalysisResult> {
    if (!fileList) {
      console.warn(`⚠️ [ProjectAnalyzer] 模块 ${moduleName} 没有找到任何文件`);
      return {
        recommended_files: [],
        reasoning: `No files found for module ${moduleName}`,
      };
    }

    if (fileList.trim() === "") {
      console.warn(
        `⚠️ [ProjectAnalyzer] 模块 ${moduleName} 的文件列表为空字符串`,
      );
      return {
        recommended_files: [],
        reasoning: `Empty file list for module ${moduleName}`,
      };
    }

    // 清空并重建文件路径映射
    this.filePathMap.clear();
    const files = fileList.split("\n").filter((file) => file.trim());
    files.forEach((file, index) => {
      this.filePathMap.set(index + 1, file.trim());
    });

    // 构建带编号的用户消息
    const userMessage = `
**User Requirements:**
${requirement}

**Module Name:**
${moduleName}

**File List:**
${files.map((file, index) => `${index + 1}. ${file}`).join("\n")}
`;

    if (!this.llm) {
      throw new Error("LLM not available for file analysis");
    }

    // 尝试加载TA+3牛码.md文件内容
    let newCoderMdContent = "";
    try {
      const newCoderFiles = await getNewCoderMdFile(this.ide);
      if (newCoderFiles.length > 0) {
        newCoderMdContent = newCoderFiles[0].content;
      }
    } catch (error) {
      console.warn("Failed to load TA+3牛码.md:", error);
    }

    try {
      const messages: ChatMessage[] = [
        {
          role: "system",
          content: `${newCoderMdContent ? `**Important Project Information from TA+3牛码.md:**\n${newCoderMdContent}\n\n` : ""}You are a software architecture and file analysis expert. Based on user requirements and the numbered list of files within the module, determine which files are most relevant to implementing or modifying code to meet the requirements.

**Instructions:**
- Analyze requirements and match them with filenames and their paths.
- Recommend any number of the most relevant files based on filenames and potential content (e.g., Java files for implementation, configuration files for settings).
- CRITICAL: Return ONLY the numbers of the recommended files, not the full paths.

**Response Format:**
Return your response in the following XML format:

<response>
<recommended_files>
<file>1</file>
<file>3</file>
<file>7</file>
</recommended_files>
<reasoning>Brief explanation of why these files were selected</reasoning>
</response>

**IMPORTANT:**
- Return ONLY the XML response without any markdown formatting or code blocks
- The XML must be well-formed and complete
- Each file number must be wrapped in <file></file> tags
- Include reasoning in <reasoning></reasoning> tags
- Do not include any text before or after the XML response`,
        },
        { role: "user", content: userMessage },
      ];

      const result = (await this.callLLMWithRetry(
        messages,
        2,
        "file",
      )) as FileAnalysisResult;

      // 将返回的编号转换为文件路径
      if (result.recommended_files) {
        const validatedFiles: string[] = [];

        for (const fileNumberStr of result.recommended_files) {
          const fileNumber = parseInt(fileNumberStr.trim());
          if (!isNaN(fileNumber) && this.filePathMap.has(fileNumber)) {
            const filePath = this.filePathMap.get(fileNumber)!;
            validatedFiles.push(filePath);
          } else {
            console.warn(`LLM返回的文件编号无效: ${fileNumberStr}`);
          }
        }

        result.recommended_files = validatedFiles;
      }

      return result;
    } catch (error) {
      console.error(`❌ [ProjectAnalyzer] analyzeFilesWithLLM 方法出错:`);
      console.error(
        `🔍 [ProjectAnalyzer] 错误类型: ${error?.constructor?.name || "Unknown"}`,
      );
      console.error(
        `📝 [ProjectAnalyzer] 错误消息: ${error instanceof Error ? error.message : String(error)}`,
      );

      // 返回空结果作为最终降级方案
      return {
        recommended_files: [],
        reasoning: "由于系统错误，无法推荐文件。请检查输入要求或重试。",
      } as FileAnalysisResult;
    }
  }

  /**
   * 先推荐最多五个叶子模块，然后为每个模块推荐相关文件 (对应Python的recommend_modules_and_files函数)
   */
  async recommendModulesAndFiles(
    requirement: string,
    projectStructure: ProjectStructure,
    rootDir: string,
  ): Promise<ModuleAndFileRecommendationResult> {
    const moduleResult = await this.recommendModules(
      requirement,
      projectStructure,
    );
    const result: ModuleAndFileRecommendationResult = {
      recommended_modules: moduleResult.recommended_modules,
      module_reasoning: moduleResult.reasoning,
      recommended_files: [],
    };

    for (let i = 0; i < (moduleResult.recommended_modules || []).length; i++) {
      const modulePath = moduleResult.recommended_modules[i];
      const fileList = await this.getDirectoryTree(modulePath, rootDir);

      const fileResult = await this.analyzeFilesWithLLM(
        requirement,
        modulePath,
        fileList,
      );

      result.recommended_files.push({
        module: modulePath,
        files: fileResult.recommended_files,
        file_reasoning: fileResult.reasoning,
      });
    }

    return result;
  }

  /**
   * 验证和修正模块文件映射中的模块路径
   * @param moduleFileMap 原始的模块文件映射
   * @param projectStructure 项目结构
   * @returns 修正后的模块文件映射
   */
  async validateModuleFileMap(
    moduleFileMap: { [moduleName: string]: string[] },
    projectStructure: ProjectStructure,
  ): Promise<{ [moduleName: string]: string[] }> {
    const validatedMap: { [moduleName: string]: string[] } = {};

    for (const [originalPath, files] of Object.entries(moduleFileMap)) {
      const validPath = await this.validateModulePath(
        originalPath,
        projectStructure,
      );

      if (validPath) {
        validatedMap[validPath] = files;
      } else {
        console.warn(`跳过无效的模块路径: ${originalPath}`);
      }
    }

    return validatedMap;
  }

  /**
   * 获取项目中所有可用的模块路径列表
   * @param projectStructure 项目结构
   * @returns 所有模块路径的数组
   */
  async getAllModulePaths(
    projectStructure: ProjectStructure,
  ): Promise<string[]> {
    const modules = await this.loadModuleInfo(projectStructure);
    return modules.map((module) => module.name);
  }

  /**
   * 检查模块路径是否有效
   * @param modulePath 要检查的模块路径
   * @param projectStructure 项目结构
   * @returns 是否有效
   */
  async isValidModulePath(
    modulePath: string,
    projectStructure: ProjectStructure,
  ): Promise<boolean> {
    const validPath = await this.validateModulePath(
      modulePath,
      projectStructure,
    );
    return validPath !== null;
  }

  /**
   * 获取模块路径的建议修正
   * @param modulePath 原始模块路径
   * @param projectStructure 项目结构
   * @returns 建议的修正路径，如果无法修正则返回null
   */
  async suggestModulePathCorrection(
    modulePath: string,
    projectStructure: ProjectStructure,
  ): Promise<string | null> {
    return await this.validateModulePath(modulePath, projectStructure);
  }

  /**
   * 调试方法：显示模块路径匹配的详细过程
   * @param modulePath 要匹配的模块路径
   * @param projectStructure 项目结构
   */
  async debugModulePathMatching(
    modulePath: string,
    projectStructure: ProjectStructure,
  ): Promise<void> {
    const modules = await this.loadModuleInfo(projectStructure);
    const normalizedPath = this.normalizeModulePath(modulePath);
    const inputModuleName = this.extractModuleName(normalizedPath);

    modules.forEach((module, index) => {
      const moduleNameFromPath = this.extractModuleName(module.name);
      const isMatch = this.isModuleNameMatch(
        moduleNameFromPath,
        inputModuleName,
      );
    });

    const result = await this.validateModulePath(modulePath, projectStructure);
  }

  /**
   * 获取模块路径映射（用于调试）
   */
  getModulePathMap(): Map<number, string> {
    return new Map(this.modulePathMap);
  }

  /**
   * 获取文件路径映射（用于调试）
   */
  getFilePathMap(): Map<number, string> {
    return new Map(this.filePathMap);
  }

  /**
   * 根据编号获取模块路径
   */
  getModulePathById(id: number): string | undefined {
    return this.modulePathMap.get(id);
  }

  /**
   * 根据编号获取文件路径
   */
  getFilePathById(id: number): string | undefined {
    return this.filePathMap.get(id);
  }

  /**
   * 清空路径映射缓存
   */
  clearPathMaps(): void {
    this.modulePathMap.clear();
    this.filePathMap.clear();
  }
}
