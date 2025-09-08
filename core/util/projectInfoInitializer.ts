import * as path from "path";
import {
  IDE,
  ILLM,
  ChatMessage,
  Tool,
  ContextItem,
  AssistantChatMessage,
} from "../index.js";
import { localPathOrUriToPath } from "./pathToUri.js";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../tools/builtIn";

interface ProjectInfo {
  name: string;
  description: string;
  packageManager: string;
  mainLanguage: string;
  frameworks: string[];
  dependencies: string[];
  structure: string;
  readme: string;
  llmAnalysis?: {
    projectSummary: string;
    architectureAnalysis: string;
    technologyStackAnalysis: string;
    codeStyle: string;
  };
}

export class ProjectInfoInitializer {
  constructor(
    private ide: IDE,
    private llm?: ILLM,
  ) {}

  /**
   * 初始化项目信息，生成 new-coder.md 文件
   */
  async initializeProjectInfo(): Promise<void> {
    try {
      const workspaceDirs = await this.ide.getWorkspaceDirs();
      if (workspaceDirs.length === 0) {
        throw new Error("没有找到工作区目录");
      }

      const rootDir = workspaceDirs[0];
      const projectInfo = await this.analyzeProject(rootDir);

      // 在生成 markdown 之前，输出 LLM 上下文日志
      console.log(
        "LLM Analysis Context:",
        JSON.stringify(projectInfo.llmAnalysis, null, 2),
      );

      const markdownContent = this.generateMarkdown(projectInfo);

      // 生成 new-coder.md 文件
      const newCoderPath = path.join(
        localPathOrUriToPath(rootDir),
        "new-coder.md",
      );
      const newCoderUri = `file://${newCoderPath.replace(/\\/g, "/")}`;

      await this.ide.writeFile(newCoderUri, markdownContent);

      console.log(`项目信息已生成到: ${newCoderPath}`);
    } catch (error) {
      console.error("项目信息初始化失败:", error);
      throw error;
    }
  }

  /**
   * 分析项目结构和信息
   */
  private async analyzeProject(rootDir: string): Promise<ProjectInfo> {
    const rootPath = localPathOrUriToPath(rootDir);

    // 简化基础信息收集
    const packageInfo = await this.analyzePackageInfo(rootDir);
    const structure = await this.analyzeProjectStructure(rootDir);
    const readme = await this.readReadmeFile(rootDir);
    const mainLanguage = await this.detectMainLanguage(rootDir);
    const frameworks = await this.detectFrameworks(packageInfo);

    const basicInfo = {
      name: packageInfo.name || path.basename(rootPath),
      description: packageInfo.description || "项目描述待补充",
      packageManager: packageInfo.packageManager,
      mainLanguage,
      frameworks,
      dependencies: packageInfo.dependencies,
      structure, // 添加缺失的structure属性
      readme,
    };

    // 强制使用 LLM 进行深度分析，如果未提供 LLM 则抛出错误
    if (!this.llm) {
      throw new Error("项目分析需要 AI 支持，请配置 LLM");
    }

    try {
      const llmAnalysis = await this.performLLMAnalysis(basicInfo, rootDir);

      // 只返回 AI 分析结果
      return {
        name: basicInfo.name,
        description: basicInfo.description,
        packageManager: basicInfo.packageManager,
        mainLanguage: basicInfo.mainLanguage,
        frameworks: [],
        dependencies: [],
        structure: "",
        readme: "",
        llmAnalysis,
      };
    } catch (error) {
      console.error("AI 分析失败:", error);
      throw new Error("项目深度分析失败，请检查 AI 配置");
    }
  }

  /**
   * 分析包管理器和依赖信息
   */
  private async analyzePackageInfo(rootDir: string): Promise<{
    name?: string;
    description?: string;
    packageManager: string;
    dependencies: string[];
  }> {
    const packageManagers = [
      { file: "package.json", manager: "npm/yarn/pnpm" },
      { file: "requirements.txt", manager: "pip" },
      { file: "Cargo.toml", manager: "cargo" },
      { file: "go.mod", manager: "go modules" },
      { file: "pom.xml", manager: "maven" },
      { file: "build.gradle", manager: "gradle" },
    ];

    for (const { file, manager } of packageManagers) {
      const filePath = path.join(localPathOrUriToPath(rootDir), file);
      const fileUri = `file://${filePath.replace(/\\/g, "/")}`;

      if (await this.ide.fileExists(fileUri)) {
        const content = await this.ide.readFile(fileUri);

        if (file === "package.json") {
          try {
            const pkg = JSON.parse(content);
            return {
              name: pkg.name,
              description: pkg.description,
              packageManager: manager,
              dependencies: [
                ...Object.keys(pkg.dependencies || {}),
                ...Object.keys(pkg.devDependencies || {}),
              ],
            };
          } catch (e) {
            console.warn("解析 package.json 失败:", e);
          }
        } else if (file === "requirements.txt") {
          const deps = content
            .split("\n")
            .filter((line) => line.trim() && !line.startsWith("#"))
            .map((line) =>
              line.split("==")[0].split(">=")[0].split("<=")[0].trim(),
            );
          return {
            packageManager: manager,
            dependencies: deps,
          };
        } else if (file === "Cargo.toml") {
          const deps = this.parseTomlDependencies(content);
          return {
            packageManager: manager,
            dependencies: deps,
          };
        }

        return {
          packageManager: manager,
          dependencies: [],
        };
      }
    }

    return {
      packageManager: "未检测到",
      dependencies: [],
    };
  }

  /**
   * 解析 TOML 格式的依赖
   */
  private parseTomlDependencies(content: string): string[] {
    const deps: string[] = [];
    const lines = content.split("\n");
    let inDependencies = false;

    for (const line of lines) {
      if (line.trim() === "[dependencies]") {
        inDependencies = true;
        continue;
      }
      if (line.trim().startsWith("[") && line.trim() !== "[dependencies]") {
        inDependencies = false;
        continue;
      }
      if (inDependencies && line.includes("=")) {
        const depName = line.split("=")[0].trim();
        if (depName) {
          deps.push(depName);
        }
      }
    }

    return deps;
  }

  /**
   * 分析项目结构
   */
  private async analyzeProjectStructure(rootDir: string): Promise<string> {
    try {
      const entries = await this.ide.listDir(rootDir);
      const structure: string[] = [];

      // 显示所有文件和目录，包括隐藏文件
      const allItems = entries.filter(([name, type]) => {
        return true; // 不过滤任何文件或目录
      });

      // 递归遍历所有目录
      const traverseDirectory = async (
        dirPath: string,
        prefix: string = "",
      ) => {
        const items = await this.ide.listDir(dirPath);
        const sortedItems = items.sort((a, b) => {
          // 文件夹优先排列
          if (a[1] === 2 && b[1] !== 2) return -1;
          if (a[1] !== 2 && b[1] === 2) return 1;
          // 然后按字母顺序排列
          return a[0].localeCompare(b[0]);
        });

        for (let i = 0; i < sortedItems.length; i++) {
          const [name, type] = sortedItems[i];
          const isLast = i === sortedItems.length - 1;
          const currentPrefix = prefix + (isLast ? "└── " : "├── ");

          if (type === 2) {
            // 目录
            structure.push(`${currentPrefix}📁 ${name}/`);
            // 递归遍历子目录
            try {
              const subDirPath = dirPath.replace(/\/$/, "") + "/" + name;
              const nextPrefix = prefix + (isLast ? "    " : "│   ");
              await traverseDirectory(subDirPath, nextPrefix);
            } catch (error) {
              console.warn(`无法访问目录 ${name}:`, error);
            }
          } else {
            // 文件
            structure.push(`${currentPrefix}📄 ${name}`);
          }
        }
      };

      // 添加根目录
      structure.push(`📁 ${rootDir.replace(/.*[\/\\]/, "")}/`);

      // 开始递归遍历
      await traverseDirectory(rootDir, "");

      return structure.join("\n");
    } catch (error) {
      console.warn("分析项目结构失败:", error);
      return "无法读取项目结构";
    }
  }

  /**
   * 读取 README 文件
   */
  private async readReadmeFile(rootDir: string): Promise<string> {
    const readmeFiles = ["README.md", "README.txt", "README", "readme.md"];

    for (const filename of readmeFiles) {
      const filePath = path.join(localPathOrUriToPath(rootDir), filename);
      const fileUri = `file://${filePath.replace(/\\/g, "/")}`;

      if (await this.ide.fileExists(fileUri)) {
        try {
          const content = await this.ide.readFile(fileUri);
          return content.substring(0, 2000); // 限制长度
        } catch (error) {
          console.warn(`读取 ${filename} 失败:`, error);
        }
      }
    }

    return "未找到 README 文件";
  }

  /**
   * 检测主要编程语言
   */
  private async detectMainLanguage(rootDir: string): Promise<string> {
    const languageExtensions: Record<string, string> = {
      ".js": "JavaScript",
      ".ts": "TypeScript",
      ".py": "Python",
      ".java": "Java",
      ".rs": "Rust",
      ".go": "Go",
      ".cpp": "C++",
      ".c": "C",
      ".cs": "C#",
      ".php": "PHP",
      ".rb": "Ruby",
      ".kt": "Kotlin",
      ".swift": "Swift",
    };

    try {
      const entries = await this.ide.listDir(rootDir);
      const extensionCounts: Record<string, number> = {};

      for (const [name, type] of entries) {
        if (type === 1) {
          // 文件
          const ext = path.extname(name).toLowerCase();
          if (languageExtensions[ext]) {
            extensionCounts[ext] = (extensionCounts[ext] || 0) + 1;
          }
        }
      }

      if (Object.keys(extensionCounts).length === 0) {
        return "未知";
      }

      const mostCommonExt = Object.keys(extensionCounts).reduce((a, b) =>
        extensionCounts[a] > extensionCounts[b] ? a : b,
      );

      return languageExtensions[mostCommonExt] || "未知";
    } catch (error) {
      console.warn("检测编程语言失败:", error);
      return "未知";
    }
  }

  /**
   * 使用 LLM 进行深度项目分析
   */
  private async performLLMAnalysis(
    basicInfo: Omit<ProjectInfo, "llmAnalysis">,
    rootDir: string,
  ): Promise<ProjectInfo["llmAnalysis"]> {
    if (!this.llm) {
      return undefined;
    }

    // 添加工作路径信息到上下文
    const workspaceDirs = await this.ide.getWorkspaceDirs();

    try {
      // 构建分析提示，提供工具让AI主动获取信息
      const analysisPrompt = `请分析以下项目信息，总结项目文档。你需要主动使用提供的工具来获取更多项目详细信息，然后再进行分析总结。
      对项目分析的目的是了解项目总结项目，使用项目总结后续结合开发需求完成开发需求。你应该尽量多的阅读项目中的文档，里面可能有关于项目的信息。

## 基础项目信息
- **项目名称**: ${basicInfo.name}
- **项目描述**: ${basicInfo.description}
- **主要编程语言**: ${basicInfo.mainLanguage}
- **包管理器**: ${basicInfo.packageManager}
- **检测到的框架**: ${basicInfo.frameworks.join(", ") || "无"}
- **工作路径**: ${rootDir}

## 可用工具
你可以并且应该使用以下工具来获取更多项目信息：
1. **builtin_ls**: 列出目录中的文件和文件夹，可以了解项目结构
   - 可以指定目录路径：{"dirPath": "src/main/java"}
   - 可以递归列出：{"dirPath": "src", "recursive": true}
2. **builtin_read_file**: 读取文件内容，可以查看具体文件如配置文件、源代码等
   - 必须指定文件路径：{"filepath": "pom.xml"}
3. **builtin_file_glob_search**: 搜索匹配特定模式的文件，可以查找特定类型的文件
   - 必须指定文件模式：{"pattern": "**/*.md"}

## 任务要求
在提供分析之前，你**必须**主动调用这些工具来获取项目详细信息。建议步骤：
1. 使用 builtin_ls 查看项目整体结构
2. 使用 builtin_read_file 读取关键配置文件
3. 使用 builtin_file_glob_search 搜索文档文件（如*.md, *.txt等）
4. 结合获取的信息进行专业分析

获取足够信息后，请提供以下分析：

## 项目概述分析
[对项目的整体概述和定位分析]

## 架构分析
[树状展示项目结构，分析各个模块用处]

## 技术栈分析
[对使用的技术栈、框架、工具的深入分析]

## 代码风格与标准
[结合文档内容和技术栈信息，分析项目的代码风格规范和标准]

请确保分析内容专业、实用，并针对具体的技术栈和项目特点给出建议。在开始分析前，你必须先使用工具获取项目信息。`;

      // 调用 LLM 进行分析，提供工具支持
      let messages: ChatMessage[] = [
        {
          role: "system",
          content:
            "你是一个资深的软件架构师和技术专家，擅长分析项目结构、技术栈和开发模式。请基于提供的项目信息，给出专业、详细且实用的分析和建议。你可以使用提供的工具来获取更多项目信息。",
        },
        {
          role: "user",
          content: analysisPrompt,
        },
      ];

      // 创建 AbortController 用于控制请求
      const abortController = new AbortController();
      const toolExtras = {
        ide: this.ide,
        fetch: fetch.bind(globalThis),
        workspacePaths: [rootDir],
      };

      // 循环处理多轮工具调用，直到LLM不再调用工具
      let iteration = 0;
      const maxIterations = 100; // 设置最大迭代次数防止无限循环
      let fullResponse = "";

      while (iteration < maxIterations) {
        const response = await this.llm.streamChat(
          messages,
          abortController.signal,
          {
            tools: this.getAvailableTools(),
          },
        );

        // 先收集完整的响应
        let completeResponse = "";
        let allChunks: ChatMessage[] = [];

        for await (const chunk of response) {
          completeResponse += chunk.content;
          allChunks.push(chunk);
        }

        // 然后处理收集到的完整响应
        let toolCallMessages: ChatMessage[] = [];
        let assistantToolCallMessages: ChatMessage[] = []; // 保存包含工具调用的助手消息
        let pendingToolCalls: { [id: string]: any } = {}; // 临时存储正在进行中的工具调用

        for (const chunk of allChunks) {
          // 处理工具调用
          if (
            chunk.role === "assistant" &&
            "toolCalls" in chunk &&
            chunk.toolCalls
          ) {
            // 保存包含工具调用的助手消息（用于后续发送回LLM）
            assistantToolCallMessages.push(chunk);

            // 处理流式工具调用
            for (const toolCall of chunk.toolCalls) {
              // 确保工具调用有ID
              let toolCallId;
              if (toolCall.id) {
                // 如果LLM提供了ID，使用它
                toolCallId = toolCall.id;
              } else {
                // 如果没有提供ID，尝试匹配已存在的工具调用（基于function.name）
                const existingCallId = Object.keys(pendingToolCalls).find(
                  (id) =>
                    pendingToolCalls[id].function?.name ===
                    toolCall.function?.name,
                );

                if (existingCallId) {
                  // 如果找到匹配的现有工具调用，使用它的ID
                  toolCallId = existingCallId;
                } else {
                  // 否则生成新的ID
                  toolCallId = `tool_call_${Date.now()}_${Math.random()}`;
                }
              }

              // 初始化或更新工具调用
              if (!pendingToolCalls[toolCallId]) {
                pendingToolCalls[toolCallId] = {
                  id: toolCallId,
                  type: toolCall.type || "function",
                  function: {
                    name: toolCall.function?.name || "",
                    arguments: toolCall.function?.arguments || "",
                  },
                };
              } else {
                // 合并流式参数
                if (toolCall.function?.arguments) {
                  pendingToolCalls[toolCallId].function.arguments +=
                    toolCall.function.arguments;
                }
                // 更新工具名称（如果之前为空）
                if (
                  toolCall.function?.name &&
                  !pendingToolCalls[toolCallId].function.name
                ) {
                  pendingToolCalls[toolCallId].function.name =
                    toolCall.function.name;
                }
                // 更新类型（如果之前为空）
                if (toolCall.type && !pendingToolCalls[toolCallId].type) {
                  pendingToolCalls[toolCallId].type = toolCall.type;
                }
                // 如果原始ID为空但当前有ID，则更新ID
                if (!pendingToolCalls[toolCallId].id && toolCall.id) {
                  pendingToolCalls[toolCallId].id = toolCall.id;
                }
              }

              // 检查工具调用是否完成（有name即可尝试调用，即使arguments为空）
              const pendingCall = pendingToolCalls[toolCallId];
              if (pendingCall.function?.name) {
                // 如果有参数，验证是否为有效的JSON；如果没有参数，则直接执行
                let isValid = true;
                if (pendingCall.function.arguments) {
                  try {
                    // 验证参数是否为有效的JSON
                    JSON.parse(pendingCall.function.arguments);
                  } catch (e) {
                    isValid = false;
                  }
                }

                // 如果参数有效或没有参数，则执行工具调用
                if (isValid) {
                  try {
                    // 调用实际的工具处理逻辑
                    const tool = this.getAvailableTools().find(
                      (t) => t.function.name === pendingCall.function?.name,
                    );

                    if (tool) {
                      const callArgs = pendingCall.function.arguments || "{}";
                      const result = await this.callTool(
                        tool,
                        callArgs,
                        toolExtras,
                      );

                      // 创建工具响应消息
                      const toolResponse: ChatMessage = {
                        role: "tool",
                        content: result.contextItems
                          .map((item) =>
                            typeof item.content === "string"
                              ? item.content
                              : JSON.stringify(item.content),
                          )
                          .join("\n"),
                        toolCallId: pendingCall.id,
                      };
                      toolCallMessages.push(toolResponse);

                      // 从待处理列表中移除已完成的工具调用
                      delete pendingToolCalls[toolCallId];
                    }
                  } catch (parseError) {
                    // JSON解析失败，说明参数还不完整，继续累积
                  }
                }
              }
            }
          } else if (chunk.role === "tool") {
            toolCallMessages.push(chunk);
          } else {
            // 普通内容响应已经收集在completeResponse中
            fullResponse += chunk.content;
          }
        }

        // 如果没有工具调用，说明LLM已完成分析
        if (
          toolCallMessages.length === 0 &&
          Object.keys(pendingToolCalls).length === 0
        ) {
          break;
        }

        // 如果有工具调用，重新发送包含工具调用和工具结果的消息
        const newMessages = [
          ...messages,
          ...assistantToolCallMessages,
          ...toolCallMessages,
        ];
        messages = newMessages;
        iteration++;
      }

      // 解析 LLM 响应
      console.log("Parsing LLM response");
      const result = this.parseLLMResponse(fullResponse);
      console.log("Parsed result:", result);
      return result;
    } catch (error) {
      console.error("LLM 分析过程中出错:", error);
      return undefined;
    }
  }

  /**
   * 尝试修复不完整的JSON字符串
   * 处理常见的不完整情况，如缺少引号、括号等
   */
  private fixIncompleteJSON(jsonString: string): string {
    if (!jsonString || jsonString.trim() === "") {
      return "{}";
    }

    // 移除注释（单行和多行）
    let json = jsonString
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    // 尝试修复缺少的引号
    json = json.replace(/([{\s,])(\w+)(\s*:)/g, '$1"$2"$3');

    // 尝试闭合不完整的对象
    const openBraces =
      (json.match(/{/g) || []).length - (json.match(/}/g) || []).length;
    const openBrackets =
      (json.match(/\[/g) || []).length - (json.match(/]/g) || []).length;

    // 添加缺失的闭合括号
    json += "}".repeat(openBraces > 0 ? openBraces : 0);
    json += "]".repeat(openBrackets > 0 ? openBrackets : 0);

    // 尝试修复结尾处的不完整值
    json = json.replace(/"([^"]*)$/, '"$1"');
    // 修复不完整的数字值
    json = json.replace(/([:,]\s*)(-?\d+\.?\d*)?$/, '"$2"');
    // 修复不完整的布尔值
    json = json.replace(/([:,]\s*)(true|false)?$/i, '"$2"');
    // 修复不完整的null值
    json = json.replace(/([:,]\s*)(null)?$/i, '"$2"');

    // 确保最终结果是有效的JSON对象
    try {
      JSON.parse(json);
      return json;
    } catch (e) {
      // 如果仍然失败，返回空对象
      return "{}";
    }
  }

  /**
   * 调用工具方法
   */
  private async callTool(
    tool: Tool,
    callArgs: string,
    extras: any,
  ): Promise<{
    contextItems: ContextItem[];
    errorMessage: string | undefined;
  }> {
    try {
      console.log(`Executing tool: ${tool.function.name}`);
      const args = JSON.parse(callArgs || "{}");
      console.log(`Parsed args:`, args);

      // 调用实际的工具实现
      switch (tool.function.name) {
        case BuiltInToolNames.LSTool:
          console.log("Executing LSTool via actual implementation");
          // 导入并调用实际的工具实现
          const { lsToolImpl } = await import(
            "../tools/implementations/lsTool"
          );
          const lsResult = {
            contextItems: await lsToolImpl(args, extras),
            errorMessage: undefined,
          };
          console.log(`LSTool result:`, JSON.stringify(lsResult, null, 2));
          return lsResult;

        case BuiltInToolNames.ReadFile:
          console.log("Executing ReadFile via actual implementation");
          const { readFileImpl } = await import(
            "../tools/implementations/readFile"
          );
          const readResult = {
            contextItems: await readFileImpl(args, extras),
            errorMessage: undefined,
          };
          console.log(`ReadFile result:`, JSON.stringify(readResult, null, 2));
          return readResult;

        case BuiltInToolNames.FileGlobSearch:
          console.log("Executing FileGlobSearch via actual implementation");
          const { fileGlobSearchImpl } = await import(
            "../tools/implementations/globSearch"
          );
          const globResult = {
            contextItems: await fileGlobSearchImpl(args, extras),
            errorMessage: undefined,
          };
          console.log(
            `FileGlobSearch result:`,
            JSON.stringify(globResult, null, 2),
          );
          return globResult;

        default:
          throw new Error(`Tool "${tool.function.name}" not found`);
      }
    } catch (e) {
      let errorMessage = `${e}`;
      if (e instanceof Error) {
        errorMessage = e.message;
      }
      console.error(`Error executing tool ${tool.function.name}:`, e);
      const errorResult = {
        contextItems: [],
        errorMessage,
      };
      console.log(`Error result:`, JSON.stringify(errorResult, null, 2));
      return errorResult;
    }
  }

  /**
   * 获取可用的工具列表
   */
  private getAvailableTools(): Tool[] {
    return [
      {
        type: "function",
        function: {
          name: BuiltInToolNames.LSTool,
          description:
            "列出指定目录中的文件和文件夹。不传参数时默认列出当前目录内容。",
          parameters: {
            type: "object",
            properties: {
              dirPath: {
                type: "string",
                description:
                  "要列出内容的目录路径，默认为当前目录（相对于项目根目录）",
              },
              recursive: {
                type: "boolean",
                description: "是否递归列出子目录内容，默认为false",
              },
            },
            // 不强制要求参数，因为可以使用默认值
          },
        },
        displayTitle: "列出目录内容",
        group: BUILT_IN_GROUP_NAME,
        readonly: true,
      },
      {
        type: "function",
        function: {
          name: BuiltInToolNames.ReadFile,
          description: "读取指定文件的内容",
          parameters: {
            type: "object",
            properties: {
              filepath: {
                type: "string",
                description: "要读取的文件路径（相对于项目根目录）",
              },
            },
            required: ["filepath"],
          },
        },
        displayTitle: "读取文件",
        group: BUILT_IN_GROUP_NAME,
        readonly: true,
      },
      {
        type: "function",
        function: {
          name: BuiltInToolNames.FileGlobSearch,
          description: "搜索匹配特定模式的文件",
          parameters: {
            type: "object",
            properties: {
              pattern: {
                type: "string",
                description: "文件匹配模式，如**/*.ts、src/**/*.js等",
              },
            },
            required: ["pattern"],
          },
        },
        displayTitle: "文件搜索",
        group: BUILT_IN_GROUP_NAME,
        readonly: true,
      },
    ];
  }

  /**
   * 解析 LLM 响应
   */
  private parseLLMResponse(response: string): ProjectInfo["llmAnalysis"] {
    try {
      // 使用正则表达式提取各个部分
      const sections = {
        projectSummary: this.extractSection(response, "项目概述分析"),
        architectureAnalysis: this.extractSection(response, "架构分析"),
        technologyStackAnalysis: this.extractSection(response, "技术栈分析"),
        codeStyle: this.extractSection(response, "代码风格与标准"),
      };

      return sections;
    } catch (error) {
      console.warn("解析 LLM 响应失败:", error);
      return {
        projectSummary: response.substring(0, 500) + "...",
        architectureAnalysis: "LLM 分析解析失败",
        technologyStackAnalysis: "LLM 分析解析失败",
        codeStyle: "LLM 分析解析失败",
      };
    }
  }

  /**
   * 从响应中提取特定部分
   */
  private extractSection(response: string, sectionTitle: string): string {
    const regex = new RegExp(
      `##\\s*${sectionTitle}\\s*\\n([\\s\\S]*?)(?=\\n##|$)`,
      "i",
    );
    const match = response.match(regex);
    return match ? match[1].trim() : `未找到${sectionTitle}部分`;
  }

  /**
   * 检测框架
   */
  private async detectFrameworks(packageInfo: any): Promise<string[]> {
    const frameworks: string[] = [];
    const deps = packageInfo.dependencies || [];

    const frameworkMap = {
      react: "React",
      vue: "Vue.js",
      angular: "Angular",
      express: "Express.js",
      next: "Next.js",
      nuxt: "Nuxt.js",
      svelte: "Svelte",
      fastapi: "FastAPI",
      django: "Django",
      flask: "Flask",
      spring: "Spring",
      laravel: "Laravel",
    };

    for (const dep of deps) {
      const depLower = dep.toLowerCase();
      for (const [key, framework] of Object.entries(frameworkMap)) {
        if (depLower.includes(key)) {
          frameworks.push(framework);
        }
      }
    }

    return [...new Set(frameworks)]; // 去重
  }

  /**
   * 生成 Markdown 内容
   */
  private generateMarkdown(projectInfo: ProjectInfo): string {
    const currentDate = new Date().toLocaleDateString("zh-CN");
    const hasLLMAnalysis = projectInfo.llmAnalysis;

    // 如果没有 AI 分析结果，则抛出错误
    if (!hasLLMAnalysis) {
      throw new Error("无法生成项目文档：缺少 AI 分析结果");
    }

    return `# ${projectInfo.name} - 项目信息

> 📅 生成时间: ${currentDate}

## 🧠 AI 深度分析

### 📊 项目概述分析
${projectInfo.llmAnalysis!.projectSummary}

### 🏗️ 架构分析
${projectInfo.llmAnalysis!.architectureAnalysis}

### ⚙️ 技术栈分析
${projectInfo.llmAnalysis!.technologyStackAnalysis}

### ⚙️ 代码风格与标准
${projectInfo.llmAnalysis!.codeStyle}
---
`;
  }
}
