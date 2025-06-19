import * as path from "node:path";
import { IDE, ILLM, ChatMessage } from "../index.js";
import { localPathToUri, localPathOrUriToPath } from "./pathToUri.js";

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
  constructor(
    private ide: IDE,
    private llm?: ILLM,
  ) {}

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

    console.log(`开始分析Maven项目: ${normalizedProjectRoot}`);
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
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (trimmedLine && !trimmedLine.startsWith("#")) {
            patterns.push(trimmedLine);
          }
        }
      } catch (error) {
        console.warn(
          `警告: 无法读取 .gitignore 文件 ${gitignorePath}: ${error}`,
        );
      }
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
      console.warn(`警告: 模块目录不存在: ${moduleDir}`);
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

        for (const [entryName, fileType] of entries.sort()) {
          const entryPath = path.join(directory, entryName);

          if (
            this.shouldIgnore(entryPath, normalizedRootDir, gitignorePatterns)
          ) {
            continue;
          }

          if (fileType === 1) {
            // File
            const ext = path.extname(entryName).toLowerCase();
            if (ALLOWED_EXTENSIONS.has(ext)) {
              const relPath = path
                .relative(moduleDir, entryPath)
                .replace(/\\/g, "/");
              files.push(relPath);
            }
          } else if (fileType === 2) {
            // Directory
            const subFiles = await collectFiles(entryPath);
            files.push(...subFiles);
          }
        }
      } catch (error) {
        console.warn(`警告: 无法访问 ${directory}: ${error}`);
      }
      return files;
    };

    const files = await collectFiles(moduleDir);
    return files.join("\n");
  }

  /**
   * 根据需求推荐最多三个叶子模块 (对应Python的recommend_modules函数)
   */
  async recommendModules(
    requirement: string,
    projectStructure: ProjectStructure,
  ): Promise<ModuleRecommendationResult> {
    // 加载并展平模块信息（仅叶子模块）
    const modules = await this.loadModuleInfo(projectStructure);

    // 构建模块推荐提示
    const prompt = `
You are an expert in software architecture and module analysis. Given a user requirement and a list of leaf modules (modules with no submodules) with their descriptions, determine which module(s) are most relevant for implementing or modifying code to meet the requirement. Return a JSON object with:
- "recommended_modules": a list of up to three leaf module paths that are most relevant
- "reasoning": a brief explanation of why these modules were chosen

**User Requirement:**
${requirement}

**Leaf Modules Information:**
${modules.map((module) => `- ${module.name}: ${module.description}`).join("\n")}

**Instructions:**
- Analyze the requirement and match it to the module descriptions.
- Recommend up to three most relevant leaf module(s) based on functionality.
- If fewer than three leaf modules are relevant, return only those.
- Ensure all recommended modules are leaf modules (no submodules).
- Return the response in JSON format.
- IMPORTANT: Return ONLY pure JSON text without any markdown formatting (no \`\`\`json code blocks). The response must be valid JSON that can be directly parsed.
`;

    // 调用LLM推荐模块
    if (!this.llm) {
      throw new Error("LLM not available for module recommendation");
    }

    try {
      const messages: ChatMessage[] = [
        {
          role: "system",
          content: "You are a helpful assistant for code module analysis.",
        },
        { role: "user", content: prompt },
      ];

      const response = await this.llm.chat(
        messages,
        new AbortController().signal,
        {
          temperature: 0.1,
          maxTokens: 1000,
        },
      );

      const content = response.content;
      const result = JSON.parse(<string>content) as ModuleRecommendationResult;

      if (result.recommended_modules && result.recommended_modules.length > 3) {
        result.recommended_modules = result.recommended_modules.slice(0, 3);
        result.reasoning +=
          " (Note: Limited to top 3 leaf modules as per requirement.)";
      }

      return result;
    } catch (error) {
      throw new Error(`LLM调用失败: ${error}`);
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
      return {
        recommended_files: [],
        reasoning: `No files found for module ${moduleName}`,
      };
    }

    const prompt = `
You are a software architecture and file analysis expert. Based on user requirements and the list of files within the module, determine which files are most relevant to implementing or modifying code to meet the requirements. Return a JSON object containing the following:
- "recommended_files": A list of paths to the most relevant files (relative to the module directory)
- "reasoning": A brief explanation of why these files were selected

**User Requirements:**
${requirement}

**Module Name:**
${moduleName}

**File List:**
${fileList}

**Instructions:**
- Analyze requirements and match them with filenames and their paths.
- Recommend any number of the most relevant files based on filenames and potential content (e.g., Java files for implementation, configuration files for settings).
- Provide clear and concise reasoning for your choices.
- Return the response in JSON format.
- IMPORTANT: Return ONLY pure JSON text without any markdown formatting (no \`\`\`json code blocks). The response must be valid JSON that can be directly parsed.
`;

    if (!this.llm) {
      throw new Error("LLM not available for file analysis");
    }

    try {
      const messages: ChatMessage[] = [
        {
          role: "system",
          content: "You are a helpful assistant for code file analysis.",
        },
        { role: "user", content: prompt },
      ];

      const response = await this.llm.chat(
        messages,
        new AbortController().signal,
        {
          temperature: 0.1,
          maxTokens: 1000,
        },
      );

      const content = response.content;
      return JSON.parse(<string>content) as FileAnalysisResult;
    } catch (error) {
      throw new Error(`LLM调用失败: ${error}`);
    }
  }

  /**
   * 先推荐最多三个叶子模块，然后为每个模块推荐相关文件 (对应Python的recommend_modules_and_files函数)
   */
  async recommendModulesAndFiles(
    requirement: string,
    projectStructure: ProjectStructure,
    rootDir: string,
  ): Promise<ModuleAndFileRecommendationResult> {
    // 第一步：推荐最多三个叶子模块
    const moduleResult = await this.recommendModules(
      requirement,
      projectStructure,
    );

    // 第二步：为每个推荐模块分析文件
    const result: ModuleAndFileRecommendationResult = {
      recommended_modules: moduleResult.recommended_modules,
      module_reasoning: moduleResult.reasoning,
      recommended_files: [],
    };

    for (const modulePath of moduleResult.recommended_modules || []) {
      const fileList = await this.getDirectoryTree(modulePath, rootDir);
      console.log(fileList);
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
}
