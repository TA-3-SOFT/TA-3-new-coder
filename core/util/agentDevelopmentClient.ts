import { FetchFunction, ILLM } from "../index.js";
import * as path from "path";
import * as fs from "fs";
// @ts-ignore
import { cos_sim } from "../vendor/modules/@xenova/transformers/src/utils/maths.js";

import { KnowledgeApiService } from "./knowledgeApiService";

export interface DevelopmentKnowledgeResponse {
  selectedUtilClasses: string[];
  frameworkRules: string[];
  frameworkQuestions: string[];
}

export interface RemoteKnowledgeResponse {
  answer: string;
  results: any[];
}

export interface UtilClassMethod {
  className: string;
  packagePath: string;
  methods: string[];
}

export interface UtilClassAnalysisResponse {
  selectedMethods: UtilClassMethod[];
}

export interface UtilClassWithKeywords {
  className: string;
  keywords: string[];
}

export class AgentDevelopmentClient {
  private fetch: FetchFunction;
  private llm: ILLM;
  private knowledgeApiUrl: string;
  private embeddingsProvider?: ILLM;
  private utilClassKeywords: UtilClassWithKeywords[] = [];

  constructor(
    fetch: FetchFunction,
    llm: ILLM,
    embeddingsProvider?: ILLM,
    knowledgeApiUrl: string = "http://172.20.23.119:18000/deep-retrieve/",
  ) {
    this.fetch = fetch;
    this.llm = llm;
    this.embeddingsProvider = embeddingsProvider;
    this.knowledgeApiUrl = knowledgeApiUrl;
  }

  /**
   * 读取本地工具类方法签名文件
   * @param utilClassName 工具类名称
   * @returns 工具类的方法签名信息
   */
  private async readUtilClassMethods(
    utilClassName: string,
  ): Promise<UtilClassMethod | null> {
    try {
      // 构建文件路径 - 支持开发环境和打包环境
      let filePath: string;

      // 在打包环境中，ta404util 目录会被复制到 out 目录下
      // 首先尝试从打包后的位置读取
      const packagedPath = path.join(
        process.cwd(),
        "ta404util",
        `${utilClassName}_methods.txt`,
      );

      if (fs.existsSync(packagedPath)) {
        filePath = packagedPath;
      } else {
        // 开发环境：相对于当前文件的路径
        let currentDir: string;
        if (typeof import.meta.url !== "undefined") {
          // ES6 模块环境
          const fileUrl = new URL(import.meta.url);
          currentDir = path.dirname(fileUrl.pathname);
          // Windows 平台路径处理
          if (process.platform === "win32" && currentDir.startsWith("/")) {
            currentDir = currentDir.substring(1);
          }
        } else {
          // 回退到相对路径
          currentDir = __dirname || path.resolve(".");
        }
        filePath = path.join(
          currentDir,
          "ta404util",
          `${utilClassName}_methods.txt`,
        );
      }

      // 使用 fs.promises 读取文件
      const content = await fs.promises.readFile(filePath, "utf-8");
      if (!content.trim()) {
        console.warn(`工具类方法文件 ${filePath} 为空`);
        return null;
      }

      const lines = content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line);

      // 提取包路径
      let packagePath = "";
      const packageLine = lines.find((line) =>
        line.startsWith("Package Path:"),
      );
      if (packageLine) {
        packagePath = packageLine.replace("Package Path:", "").trim();
      }

      // 提取方法签名（跳过包路径行和空行）
      const methods = lines.filter(
        (line) =>
          line &&
          !line.startsWith("Package Path:") &&
          (line.includes("public static") || line.includes("public ")),
      );

      return {
        className: utilClassName,
        packagePath,
        methods,
      };
    } catch (error) {
      console.error(`读取工具类 ${utilClassName} 方法签名失败:`, error);
      return null;
    }
  }

  /**
   * 通过远程API获取开发相关知识
   * @param query 查询内容，可以是工具类名称或开发规范问题
   * @param collection 知识库集合名称
   */
  private async getRemoteKnowledge(
    query: string,
    collection: string = "Ta3404_Framework_Backend_Dev_Knowledge",
  ): Promise<RemoteKnowledgeResponse> {
    try {
      const params = new URLSearchParams({
        original_query: query,
        collection: collection,
        max_iter: "1",
      });

      const response = await this.fetch(`${this.knowledgeApiUrl}?${params}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        console.warn(`Knowledge API request failed: ${response.status}`);
        return { answer: "", results: [] };
      }

      // Handle streaming response - 适配Node.js环境
      let fullText: any[] = [];
      let answer = "";
      let responseText = "";

      try {
        // 在Node.js环境中，直接读取响应文本
        responseText = await response.text();
        const lines = responseText.split("\n");

        // 累积所有的答案和结果
        let allAnswers: string[] = [];
        let allResults: any[] = [];

        for (const line of lines) {
          if (
            line.trim() &&
            !line.startsWith(":") &&
            line.startsWith("data: ")
          ) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.answer) {
                allAnswers.push(data.answer);
              }
              if (data.results && Array.isArray(data.results)) {
                allResults.push(...data.results);
              } else if (data.results) {
                allResults.push(data.results);
              }
            } catch (e) {
              // Skip invalid JSON
              console.debug("Failed to parse SSE data:", line);
            }
          }
        }

        // 处理结果：优先使用results中的内容，因为answer通常只是提示信息
        fullText = allResults;

        // 如果有results，格式化为可读的答案
        if (fullText.length > 0) {
          const formattedResults = fullText.map((result: any) => {
            if (typeof result === "string") {
              return result;
            } else if (result.content) {
              // 清理HTML标签，提取纯文本内容
              const cleanContent = result.content
                .replace(/<[^>]*>/g, " ") // 移除HTML标签
                .replace(/&nbsp;/g, " ") // 替换&nbsp;
                .replace(/\s+/g, " ") // 合并多个空格
                .trim();

              return `**${result.document_name || "文档"}**\n${cleanContent}`;
            } else {
              return JSON.stringify(result, null, 2);
            }
          });

          answer = formattedResults.join("\n\n");
        } else {
          // 如果没有results，使用answer内容
          answer = allAnswers.join("\n");
        }

        console.debug(
          `Processed ${allAnswers.length} answer chunks, ${allResults.length} result chunks`,
        );
        console.debug("Final answer length:", answer.length);
        console.debug("Final results count:", fullText.length);

        // 如果没有通过SSE获取到数据，尝试直接解析整个响应
        if (!answer && !fullText.length) {
          console.debug("No SSE data found, trying to parse as JSON");
          try {
            const jsonResponse = JSON.parse(responseText);
            if (jsonResponse.results && Array.isArray(jsonResponse.results)) {
              fullText = jsonResponse.results;
              // 格式化results为答案
              const formattedResults = fullText.map((result: any) => {
                if (typeof result === "string") {
                  return result;
                } else if (result.content) {
                  const cleanContent = result.content
                    .replace(/<[^>]*>/g, " ")
                    .replace(/&nbsp;/g, " ")
                    .replace(/\s+/g, " ")
                    .trim();
                  return `**${result.document_name || "文档"}**\n${cleanContent}`;
                } else {
                  return JSON.stringify(result, null, 2);
                }
              });
              answer = formattedResults.join("\n\n");
            } else if (jsonResponse.answer) {
              answer = jsonResponse.answer;
            }
          } catch (e) {
            console.debug(
              "Response is not JSON format, treating as plain text",
            );
            // 如果都不是，就把整个响应作为答案
            if (responseText.trim()) {
              answer = responseText.trim();
            }
          }
        }
      } catch (streamError) {
        console.warn("Error processing streaming response:", streamError);
        // 使用已经读取的响应文本作为fallback
        if (responseText.trim()) {
          console.debug("Using raw response text as fallback");
          return { answer: responseText.trim(), results: [] };
        }
        return { answer: "", results: [] };
      }

      return { answer, results: fullText };
    } catch (error) {
      console.error("Error fetching remote knowledge:", error);
      return { answer: "", results: [] };
    }
  }

  /**
   * 分析用户需求和开发计划，获取相关的工具类和开发规范
   */
  async analyzeDevelopmentRequirements(
    userRequirement: string,
  ): Promise<DevelopmentKnowledgeResponse> {
    try {
      // 定义所有可用的工具类
      const availableUtilClasses = [
        "AESUtils",
        "AgeUtils",
        "AntPathMatcher",
        "AreaUtils",
        "ArrayUtils",
        "AssertUtils",
        "Base64Utils",
        "BCECUtils",
        "CalculateUtils",
        "CaptchaImageUtils",
        "CaptchaObject",
        "CaptchaUtils",
        "CharSequenceUtils",
        "CharUtils",
        "CompressionUtils",
        "DateConvertUtils",
        "DateUtils",
        "DesensitizeUtils",
        "EmailUtils",
        "ExcelUtils",
        "ExceptionUtils",
        "FileSystemUtil",
        "FileTypesUtil",
        "FontUtils",
        "FTPUtils",
        "GmBaseUtils",
        "HtmlUtils",
        "HttpUtils",
        "IdCardUtils",
        "ImageUtils",
        "JSONUtils",
        "JWTUtils",
        "KeyUtils",
        "ListUtils",
        "MapUtils",
        "MD5Utils",
        "MoneyUtils",
        "NetUtils",
        "NumberUtils",
        "ObjectUtils",
        "OFDUtils",
        "PaginationUtils",
        "PasswordUtils",
        "PDFUtils",
        "PhoneUtils",
        "PinyinUtils",
        "QRCodeUtils",
        "RandomUtils",
        "ReflectionUtils",
        "RegexUtils",
        "RSAUtils",
        "ScriptUtils",
        "SHAUtils",
        "SM2Utils",
        "SM3Utils",
        "SM4Utils",
        "SocketUtils",
        "StringUtils",
        "SystemUtils",
        "ThreadUtils",
        "TreeUtils",
        "UrlUtils",
        "USCUtils",
        "WebUtil",
        "WordUtils",
        "XMLUtils",
      ];

      // 定义完整的开发规范内容
      const frameworkRules = `
 **继承约束**：
  - service的基类应当为 BaseService，里面包括很多内部方法
  - rest的基类应当为 BaseRestService，里面包括很多内部方法
  - mapper 需继承公共根mapper Ta404SupportMapper，如果使用mybatisPlus，则继承 Ta404SupportPlusMapper，公共根mapper提供了面向数据库的序列获取、时间获取、分页等方法。
**开发框架约束**：
  - 需要满足Ta+3 404框架的开发规范
  - 事务说明
    1. 数据源和事务管理器是一一对应的，所有service都应该进行分类，一个
       service里面只能注入同一数据源的dao或者mapper，如果需要用到其
       他数据源，则应该以service的形式注入进去
    2. 所有事务均在service上去配置，不要在dao层去配置
    3. service上添加@TaTransactional注解表示需要事务,使用的是
       mybatis，由框架自动分配事务管理器，
       @TaTransactional(value="mydsTransactionManager")手动指定事务
       管理器，此时框架将不会自动分配
    4. service上添加@NoTransactional注解明确表示不需要事务，框架将不
       对此service做任何处理
    5. 所有service均应该配置@TaTransactional或者@NoTransactional注
       解，否则项目启动将报错
  - 缓存使用
    * 在缓存层内置四套实现并与 Spring-Cache 无缝对接：
    * **可选方案**
      1. **Ehcache**（默认）本地缓存，XML 配置支持 *TTL / TTI / none* 过期策略；
      2. **Caffeine** 本地缓存，YAML 设置 \`initial-capacity / maximum-size / expire-after-write|access\`，可为单个 cache 覆盖；
      3. **Redis** 分布式缓存，支持 *single / cluster*；可统一或按 cache 名配置 \`expire\`，全面暴露 Lettuce 连接池参数；
    * **启用方式**：按需引入相应 *starter* 依赖并在 \`ta404.modules.cache.<type>.active=true\`；如同时引入多套实现，指定 \`ta404.modules.cache.primary=<type>\` 作为 Spring-Cache 主方案。
    * **开发使用**
      * 注解：\`@Cacheable / @CachePut / @CacheEvict\` 等标准 Spring-Cache 注解；
      * 编程：注入 \`ITaCacheManager taCacheManager\` 获取 \`ITaCache\` 进行 API 操作。
    * **集群策略**：Ehcache/Caffeine 无同步；Redis/Coherence 依托自身集群即可。
    * **常见场景**：本地高并发读优先 Ehcache/Caffeine；需要跨节点一致性采用 Redis；Coherence 仅保留兼容。
  - 数据校验使用
    1. 主要引入了基于 \`@V\` 的参数/VO 校验体系：
    2. \`@V\` 支持内置规则、YAML 配置正则和行内正则混用，可通过 \`notnull | min=N | max=N | regex=\` 等语法快速声明限制。
    3. 若在类/方法或嵌套 VO 中使用，需配合 \`@Validated\`；同一字段可叠加多重 \`@V\`。
    5. YAML 可在 \`ta404.validation.customRegex\` 下集中定义命名正则（如 \`customEmail\`、\`customCellphone\`），在注解里直接填配置名即可复用。
    6. 5.4.0 新增 \`path\` 属性，可指向 YAML 规则清单并覆盖注解本身，方便集中维护。
    7. 建议：统一正则命名、将通用规则放配置层、全局异常拦截统一返回提示，并在文档中添加目录锚点与请求/响应示例以便前端联调。
  - 时间序列获取
    1. DateUtils.getCurrentDate() 取服务器时间（节点间可能不一致）；
    2. 推荐：Service 继承 BaseService 用 getSysTimestamp()/getSysDate() 等取数据库时间，确保分布式一致；
    3. 自定义：实现 TimeDao 覆盖默认策略，可接第三方时间服务。
    4. 序列获取：通过 getStringSeq(String seqName)（或无参取默认 SEQ_DEFAULT）返回下一个值；旧接口 getSequence 仍兼容。默认基于数据库序列，若项目引入全局序列组件会自动切换（可用 Snowflake 等）。
    5. 最佳实践：生产环境应统一用数据库/集中时间；监控时间与序列调用异常；Service 均继承 BaseService，序列名用常量集中管理。
       在「序列化」方面提供双套 JSON 方案，并可在 Web 报文层二选一：
  - 异常处理
    * 异常体系围绕 **AppException** 统一处理并向前端返回默认错误码 **418**：
    * **框架已拦截**：\`MethodArgumentNotValidException\`、\`BindException\`、\`HttpRequestMethodNotSupportedException\`、\`ConstraintViolationException\` 以及兜底 \`Throwable\`，均封装为 418 并记录日志。
    * **最佳实践**：统一错误码编码规则，Service 层按需抛出 \`AppException\`；监控日志中异常入库，确保前端弹框提示与后端日志一致。
  - 字典模块 
    - 通过 **ta404-module-dict** 提供字典管理：
    * **YAML 开关**：\`open-cache\`(默认 true) 控制缓存；\`enable-system-dict-protect\` 设为 true 时系统字典只读并缓存到 localStorage；\`authority\` 决定初始化加载的权限标识。
    * **DictUtils** 工具类集中封装查询：\`getDict\`／\`getCodeList\`／\`getBatchCode\` 等，可按字典类型、权限批量或单条获取，支持 JSON 字符串返回与排序。
`;

      // 使用系统LLM分析需求，选择工具类和生成问题
      const analysisPrompt = `
根据以下开发需求和计划，从给定的工具类列表中选择可能需要的工具类，并为每个选中的工具类生成3-5个关键词来描述需要用到的方法功能：

用户需求：
${userRequirement}

可用的工具类列表：
${availableUtilClasses.join(", ")}

Ta+3 404框架开发规范：
${frameworkRules}

请分析并返回：
1. 从工具类列表中选择可能需要使用的工具类名称，并为每个工具类生成关键词来描述所有需要的方法功能
2. 针对开发规范中可能不清楚或需要详细了解的地方，生成具体的提问句子

请直接返回纯JSON格式，不要包含任何代码块标记：
{
  "selectedUtilClassesWithKeywords": [
    {
      "className": "StringUtils",
      "keywords": ["验证", "格式化", "转换", "校验"]
    },
    {
      "className": "DateUtils",
      "keywords": ["当前时间", "格式化", "计算"]
    }
  ],
  "frameworkQuestions": ["针对事务管理规范的具体提问？", "关于缓存配置的详细问题？"]
}

注意：请确保返回的是有效的JSON格式，不要添加json的代码块标记。
`;

      // 创建一个AbortController来提供signal
      const abortController = new AbortController();
      const analysisResult = await this.llm.complete(
        analysisPrompt,
        abortController.signal,
      );

      let selectedUtilClasses: string[] = [];
      let selectedUtilClassesWithKeywords: UtilClassWithKeywords[] = [];
      let frameworkQuestions: string[] = [];

      try {
        // 清理LLM返回的内容，移除可能的代码块标记
        let cleanedResult = analysisResult.trim();

        // 更健壮地处理各种可能的代码块格式
        // 处理 ```json 格式（包括可能的大小写变体）
        if (cleanedResult.toLowerCase().startsWith("```json")) {
          cleanedResult = cleanedResult
            .replace(/^```json\s*/i, "")
            .replace(/\s*```$/, "");
        }
        // 处理其他以 ``` 开头的格式
        else if (cleanedResult.startsWith("```")) {
          // 找到第一个换行符的位置，从那之后的内容才是真正的JSON
          const firstNewlineIndex = cleanedResult.indexOf("\n");
          if (firstNewlineIndex !== -1) {
            cleanedResult = cleanedResult.substring(firstNewlineIndex + 1);
          } else {
            // 如果没有换行符，就移除开头的 ```
            cleanedResult = cleanedResult.substring(3);
          }
          // 移除结尾的 ```
          if (cleanedResult.endsWith("```")) {
            cleanedResult = cleanedResult.substring(
              0,
              cleanedResult.length - 3,
            );
          }
        }

        // 再次清理，确保移除任何前后的空白字符
        cleanedResult = cleanedResult.trim();

        const parsed = JSON.parse(cleanedResult);
        selectedUtilClassesWithKeywords =
          parsed.selectedUtilClassesWithKeywords || [];
        selectedUtilClasses = selectedUtilClassesWithKeywords.map(
          (item) => item.className,
        );
        frameworkQuestions = parsed.frameworkQuestions || [];

        // 将关键词信息存储起来，供后续向量匹配使用
        this.utilClassKeywords = selectedUtilClassesWithKeywords;
      } catch (e) {
        console.error("Failed to parse LLM response:", e);
        console.error("Raw LLM response:", analysisResult);
      }

      return {
        selectedUtilClasses,
        frameworkRules: [frameworkRules],
        frameworkQuestions,
      };
    } catch (error) {
      console.error("Error analyzing development requirements:", error);
      return {
        selectedUtilClasses: ["分析过程中发生错误"],
        frameworkRules: ["无法获取开发规范信息"],
        frameworkQuestions: ["分析失败，请检查输入参数"],
      };
    }
  }

  /**
   * 根据用户需求和选中的工具类，使用LLM选择具体需要的方法（通过编号方式）
   * @param userRequirement 用户需求
   * @param selectedUtilClasses 已选择的工具类列表
   * @returns 选中的工具类方法
   */
  async analyzeUtilClassMethods(
    userRequirement?: string,
    selectedUtilClasses?: string[],
  ): Promise<UtilClassAnalysisResponse> {
    try {
      // 使用传入的工具类列表或从实例中获取
      const utilClassNames =
        selectedUtilClasses ||
        (this.utilClassKeywords.length > 0
          ? this.utilClassKeywords.map((item) => item.className)
          : []);

      if (utilClassNames.length === 0) {
        console.warn("没有可用的工具类信息");
        return { selectedMethods: [] };
      }

      const selectedMethods: UtilClassMethod[] = [];

      // 对每个工具类进行LLM分析
      for (const className of utilClassNames) {
        // 读取工具类方法签名
        const methodInfo = await this.readUtilClassMethods(className);
        if (!methodInfo) {
          console.warn(`无法读取工具类 ${className} 的方法签名`);
          continue;
        }

        if (!userRequirement) {
          console.warn("缺少用户需求，无法进行方法分析");
          continue;
        }

        // 为每个方法分配编号
        const numberedMethods = methodInfo.methods.map(
          (method, index) => `${index + 1}. ${method}`,
        );

        // 构建LLM提示词
        const prompt = `
根据以下开发需求和工具类方法列表，请选择可能需要使用的方法，并返回这些方法的编号。

开发需求：
${userRequirement}

工具类名称：${className}
方法列表：
${numberedMethods.join("\n")}

请返回一个JSON数组，包含所有可能需要使用的方法的编号。只返回编号数组，不要包含其他解释性文字。

示例输出格式：
[1, 3, 5]
`;

        try {
          // 调用LLM进行分析
          const abortController = new AbortController();
          const llmResponse = await this.llm.complete(
            prompt,
            abortController.signal,
          );

          // 解析LLM返回的结果
          let selectedMethodIndices: number[] = [];

          try {
            // 清理LLM返回的内容，移除可能的代码块标记
            let cleanedResult = llmResponse.trim();

            // 更健壮地处理各种可能的代码块格式
            // 处理 ```json 格式（包括可能的大小写变体）
            if (cleanedResult.toLowerCase().startsWith("```json")) {
              cleanedResult = cleanedResult
                .replace(/^```json\s*/i, "")
                .replace(/\s*```$/, "");
            }
            // 处理其他以 ``` 开头的格式
            else if (cleanedResult.startsWith("```")) {
              // 找到第一个换行符的位置，从那之后的内容才是真正的JSON
              const firstNewlineIndex = cleanedResult.indexOf("\n");
              if (firstNewlineIndex !== -1) {
                cleanedResult = cleanedResult.substring(firstNewlineIndex + 1);
              } else {
                // 如果没有换行符，就移除开头的 ```
                cleanedResult = cleanedResult.substring(3);
              }
              // 移除结尾的 ```
              if (cleanedResult.endsWith("```")) {
                cleanedResult = cleanedResult.substring(
                  0,
                  cleanedResult.length - 3,
                );
              }
            }

            // 再次清理，确保移除任何前后的空白字符
            cleanedResult = cleanedResult.trim();

            selectedMethodIndices = JSON.parse(cleanedResult);

            // 确保返回的是数字数组
            if (!Array.isArray(selectedMethodIndices)) {
              throw new Error("LLM返回的不是数组格式");
            }

            // 过滤掉无效的索引（小于1或大于方法总数）
            selectedMethodIndices = selectedMethodIndices.filter(
              (index) =>
                typeof index === "number" &&
                index >= 1 &&
                index <= methodInfo.methods.length,
            );
          } catch (parseError) {
            console.error(`解析LLM响应失败:`, parseError);
            console.error(`原始响应: ${llmResponse}`);
            // 如果解析失败，跳过这个工具类
            continue;
          }

          // 根据编号获取实际的方法签名
          const selectedMethodSignatures = selectedMethodIndices
            .map((index) => methodInfo.methods[index - 1])
            .filter(
              // 过滤掉可能的undefined值
              (method) => method !== undefined,
            );

          if (selectedMethodSignatures.length > 0) {
            selectedMethods.push({
              className: methodInfo.className,
              packagePath: methodInfo.packagePath,
              methods: selectedMethodSignatures,
            });
          }
        } catch (llmError) {
          console.error(`LLM分析工具类 ${className} 失败:`, llmError);
          // 继续处理下一个工具类
        }
      }

      return { selectedMethods };
    } catch (error) {
      console.error("分析工具类方法失败:", error);
      return { selectedMethods: [] };
    }
  }

  /**
   * 获取指定工具类的方法定义（从本地文件读取）
   */
  async getUtilClassMethods(utilName: string): Promise<string> {
    try {
      const methodInfo = await this.readUtilClassMethods(utilName);

      if (!methodInfo) {
        return `未找到${utilName}工具类的方法定义文件。`;
      }

      // 格式化返回结果
      const formattedResult = `
## ${methodInfo.className} 工具类

**包路径**: ${methodInfo.packagePath}

**方法列表**:
${methodInfo.methods.map((method, index) => `${index + 1}. ${method}`).join("\n")}
`;

      return formattedResult;
    } catch (error) {
      console.error(`Error getting methods for ${utilName}:`, error);
      return `获取${utilName}工具类方法时发生错误。`;
    }
  }

  /**
   * 获取框架规范的详细说明（使用RAG模式）
   */
  async getFrameworkRuleDetails(question: string): Promise<string> {
    try {
      // 获取知识库API服务实例
      // 注意：这里我们需要一个ControlPlaneClient实例，但在AgentDevelopmentClient中可能没有
      // 我们可以尝试使用传入的fetch函数或者创建一个简化版本
      const knowledgeApi = KnowledgeApiService.getInstance();

      // 设置组织ID - 使用默认值或从环境变量获取
      const orgId = "4176c7786222421ba4e351fd404b8488"; // 默认组织ID

      // 第一步：获取所有文档列表
      const listParams: any = {
        appId: orgId,
      };

      const allDocuments = await knowledgeApi.listDocuments(listParams);

      if (allDocuments.length === 0) {
        return `未找到任何知识库文档来回答问题: "${question}"`;
      }

      // 构造文档摘要信息供LLM选择
      const documentSummaries = allDocuments.map((doc, index) => {
        return {
          id: index + 1,
          fileName: doc.fileName,
          summary: doc.fileSummary || "无摘要",
        };
      });

      // 构造提示词，让LLM选择相关文档
      let prompt = `我有一个关于框架规范的问题: "${question}"

请根据这个问题，从以下文档列表中选择最相关的几个文档（最多5个），并返回它们的编号。

文档列表:
`;

      documentSummaries.forEach((doc) => {
        // 转义文件名和摘要中的特殊字符
        const escapedFileName = doc.fileName
          .replace(/"/g, '\\"')
          .replace(/\n/g, "\\n");
        const escapedSummary = (doc.summary || "无摘要")
          .replace(/"/g, '\\"')
          .replace(/\n/g, "\\n");
        prompt += `${doc.id}. ${escapedFileName}\n   摘要: ${escapedSummary}\n\n`;
      });

      prompt += `请只返回编号，用逗号分隔，例如: "1,3,5"。如果不相关，请返回"无"。`;

      // 使用系统LLM选择相关文档
      const abortController = new AbortController();
      const llmResponse = await this.llm.complete(
        prompt,
        abortController.signal,
      );

      // 提取LLM响应内容
      let selectedDocIdsStr = "";
      if (typeof llmResponse === "string") {
        selectedDocIdsStr = llmResponse.trim();
      }

      // 解析LLM返回的文档编号
      let selectedDocuments: any[] = [];
      if (selectedDocIdsStr && selectedDocIdsStr.trim() !== "无") {
        try {
          // 提取数字（编号）
          const ids = selectedDocIdsStr.match(/\d+/g);
          if (ids) {
            const uniqueIds = [
              ...new Set(
                ids
                  .map((id) => parseInt(id))
                  .filter((id) => id > 0 && id <= allDocuments.length),
              ),
            ];
            selectedDocuments = uniqueIds
              .slice(0, 5)
              .map((id) => allDocuments[id - 1]);
          }
        } catch (parseError) {
          console.warn("解析LLM返回的文档编号时出错:", parseError);
          // 如果解析失败，默认选择前3个文档
          selectedDocuments = allDocuments.slice(
            0,
            Math.min(3, allDocuments.length),
          );
        }
      }

      if (selectedDocuments.length === 0) {
        return `未找到与问题 "${question}" 相关的文档内容。`;
      }

      // 获取选中文档的详细内容
      const detailedDocuments = [];
      for (const doc of selectedDocuments) {
        try {
          const viewParams = {
            appId: orgId,
            documentId: doc.id,
          };
          const detailedDoc = await knowledgeApi.viewDocument(viewParams);
          detailedDocuments.push(detailedDoc);
        } catch (error) {
          console.warn(`获取文档 ${doc.fileName} 详情时出错:`, error);
          detailedDocuments.push(null);
        }
      }

      // 过滤掉获取失败的文档
      const validDocuments = detailedDocuments.filter((doc) => doc !== null);

      // 处理文档内容，如果文档过大则进行切割并交给LLM处理
      const processedResults = [];
      for (const doc of validDocuments) {
        // 检查文档大小，如果超过阈值则进行切割
        const CHUNK_SIZE = 8000; // 每个片段最大8000字符
        const content = doc!.content;

        if (content.length <= CHUNK_SIZE) {
          // 文档较小，直接处理
          const summaryPrompt = `根据以下问题：  
  
"${question}"

请分析并总结以下文档内容，提取与问题最相关的信息：

${content.replace(/"/g, '\\"').replace(/\n/g, "\\n")}

请提供简洁明了、准确无误的总结，重点突出与问题相关的内容，直接给出最终结论，不需要引用原文或分点说明：`;

          const summary = await this.llm.complete(
            summaryPrompt,
            abortController.signal,
          );

          processedResults.push({
            content:
              typeof summary === "string" ? summary : JSON.stringify(summary),
            source: doc!.fileName || "未知来源",
          });
        } else {
          // 简化处理：只取前CHUNK_SIZE字符
          const truncatedContent = content.substring(0, CHUNK_SIZE);
          const summaryPrompt = `根据以下问题：

"${question}"

请分析并总结以下文档内容，提取与问题最相关的信息：

${truncatedContent.replace(/"/g, '\\"').replace(/\n/g, "\\n")}

请提供简洁明了、准确无误的总结，重点突出与问题相关的内容，直接给出最终结论，不需要引用原文或分点说明：`;

          const summary = await this.llm.complete(
            summaryPrompt,
            abortController.signal,
          );

          processedResults.push({
            content:
              typeof summary === "string" ? summary : JSON.stringify(summary),
            source: doc!.fileName || "未知来源",
          });
        }
      }

      // 格式化返回结果
      if (processedResults.length > 0) {
        // 合并所有结果为一个简洁的结论
        const summaries = processedResults.map((result: any) => result.content);
        if (summaries.length > 1) {
          const combinePrompt = `请将以下多个总结内容合并为一个简洁明了、准确无误的最终结论，直接回答问题"${question}"，不要引用原文或分点说明：

${summaries.map((s: string) => `"${s}"`).join("\n\n")}

请提供一个统一的、简洁的、准确的最终结论：`;

          const combinedSummary = await this.llm.complete(
            combinePrompt,
            abortController.signal,
          );

          return typeof combinedSummary === "string"
            ? combinedSummary
            : JSON.stringify(combinedSummary);
        } else {
          return summaries[0];
        }
      } else {
        return `未找到关于"${question}"的详细说明，请查阅框架文档或联系技术支持。`;
      }
    } catch (error) {
      console.error(
        `Error getting framework rule details for "${question}":`,
        error,
      );
      return `获取框架规范详情时发生错误: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}
