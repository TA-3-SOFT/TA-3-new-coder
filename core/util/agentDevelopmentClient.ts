import { FetchFunction, ILLM } from "../index.js";
import * as path from "path";
import * as fs from "fs";
// @ts-ignore
import { cos_sim } from "../vendor/modules/@xenova/transformers/src/utils/maths.js";

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

export interface VectorizedMethod {
  methodSignature: string;
  vector: number[];
}

export interface MethodMatchResult {
  methodSignature: string;
  keyword: string;
  similarity: number;
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
   * 向量化方法签名
   * @param methods 方法签名数组
   * @returns 向量化的方法数组
   */
  private async vectorizeMethods(
    methods: string[],
  ): Promise<VectorizedMethod[]> {
    if (!this.embeddingsProvider) {
      throw new Error("嵌入提供者未配置");
    }

    if (!methods.length) {
      return [];
    }

    try {
      console.log(`开始向量化 ${methods.length} 个方法签名`);
      const vectors = await this.embeddingsProvider.embed(methods);

      if (!Array.isArray(vectors) || vectors.length !== methods.length) {
        throw new Error(
          `向量化结果数量不匹配: 期望 ${methods.length}, 实际 ${vectors.length}`,
        );
      }

      const vectorizedMethods: VectorizedMethod[] = methods.map(
        (method, index) => ({
          methodSignature: method,
          vector: vectors[index],
        }),
      );

      console.log(`成功向量化 ${vectorizedMethods.length} 个方法签名`);
      return vectorizedMethods;
    } catch (error) {
      console.error(`向量化方法签名失败:`, error);
      throw error;
    }
  }

  /**
   * 计算关键词与方法的相似度
   * @param keywordVector 关键词向量
   * @param methodVector 方法向量
   * @returns 相似度分数
   */
  private calculateSimilarity(
    keywordVector: number[],
    methodVector: number[],
  ): number {
    if (!keywordVector.length || !methodVector.length) {
      return 0;
    }

    try {
      return cos_sim(keywordVector, methodVector);
    } catch (error) {
      console.error(`计算相似度失败: ${error}`);
      return 0;
    }
  }

  /**
   * 使用向量匹配选择方法
   * @param utilClassName 工具类名称
   * @param keywords 关键词数组
   * @param methods 方法签名数组
   * @param threshold 相似度阈值
   * @returns 匹配的方法结果
   */
  private async vectorMatchMethods(
    utilClassName: string,
    keywords: string[],
    methods: string[],
    threshold: number = 0.3,
  ): Promise<MethodMatchResult[]> {
    if (!this.embeddingsProvider) {
      throw new Error("嵌入提供者未配置");
    }

    try {
      // 向量化关键词和方法
      const [keywordVectors, vectorizedMethods] = await Promise.all([
        this.embeddingsProvider.embed(keywords),
        this.vectorizeMethods(methods),
      ]);

      const matchResults: MethodMatchResult[] = [];

      // 对每个关键词，找到最相似的方法
      keywords.forEach((keyword, keywordIndex) => {
        const keywordVector = keywordVectors[keywordIndex];

        vectorizedMethods.forEach((vectorizedMethod) => {
          const similarity = this.calculateSimilarity(
            keywordVector,
            vectorizedMethod.vector,
          );

          if (similarity >= threshold) {
            matchResults.push({
              methodSignature: vectorizedMethod.methodSignature,
              keyword,
              similarity,
            });
          }
        });
      });

      // 按相似度排序并去重
      const uniqueResults = new Map<string, MethodMatchResult>();
      matchResults
        .sort((a, b) => b.similarity - a.similarity)
        .forEach((result) => {
          if (
            !uniqueResults.has(result.methodSignature) ||
            uniqueResults.get(result.methodSignature)!.similarity <
              result.similarity
          ) {
            uniqueResults.set(result.methodSignature, result);
          }
        });

      console.log(
        `${utilClassName} 向量匹配结果: ${uniqueResults.size} 个方法匹配`,
      );
      return Array.from(uniqueResults.values());
    } catch (error) {
      console.error(`向量匹配失败:`, error);
      return [];
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

请直接返回纯JSON格式，不要包含任何markdown代码块标记：
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

注意：请确保返回的是有效的JSON格式，不要添加json的markdown标记。
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
        // 清理LLM返回的内容，移除可能的markdown代码块标记
        let cleanedResult = analysisResult.trim();
        if (cleanedResult.startsWith("```json")) {
          cleanedResult = cleanedResult
            .replace(/^```json\s*/, "")
            .replace(/\s*```$/, "");
        } else if (cleanedResult.startsWith("```")) {
          cleanedResult = cleanedResult
            .replace(/^```\s*/, "")
            .replace(/\s*```$/, "");
        }

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
   * 根据用户需求和选中的工具类，使用向量匹配选择具体需要的方法
   * @param userRequirement 用户需求（可选，主要用于日志）
   * @param selectedUtilClasses 已选择的工具类列表（可选，如果不提供则使用存储的关键词信息）
   * @returns 选中的工具类方法
   */
  async analyzeUtilClassMethods(
    userRequirement?: string,
    selectedUtilClasses?: string[],
  ): Promise<UtilClassAnalysisResponse> {
    try {
      if (!this.embeddingsProvider) {
        throw new Error("嵌入提供者未配置，无法进行向量匹配");
      }

      // 使用存储的关键词信息或传入的工具类列表
      const utilClassesWithKeywords =
        this.utilClassKeywords.length > 0
          ? this.utilClassKeywords
          : (selectedUtilClasses || []).map((className) => ({
              className,
              keywords: [],
            }));

      if (utilClassesWithKeywords.length === 0) {
        console.warn("没有可用的工具类信息");
        return { selectedMethods: [] };
      }

      const selectedMethods: UtilClassMethod[] = [];

      // 对每个工具类进行向量匹配
      for (const utilClassInfo of utilClassesWithKeywords) {
        const { className, keywords } = utilClassInfo;

        if (keywords.length === 0) {
          console.warn(`工具类 ${className} 没有关键词，跳过向量匹配`);
          continue;
        }

        // 读取工具类方法签名
        const methodInfo = await this.readUtilClassMethods(className);
        if (!methodInfo) {
          console.warn(`无法读取工具类 ${className} 的方法签名`);
          continue;
        }

        console.log(
          `开始为工具类 ${className} 进行向量匹配，关键词: ${keywords.join(", ")}`,
        );

        // 使用向量匹配选择方法
        const matchResults = await this.vectorMatchMethods(
          className,
          keywords,
          methodInfo.methods,
          0.3, // 相似度阈值
        );

        if (matchResults.length > 0) {
          const selectedMethodSignatures = matchResults.map(
            (result) => result.methodSignature,
          );
          selectedMethods.push({
            className: methodInfo.className,
            packagePath: methodInfo.packagePath,
            methods: selectedMethodSignatures,
          });

          console.log(
            `工具类 ${className} 匹配到 ${selectedMethodSignatures.length} 个方法`,
          );
        } else {
          console.log(`工具类 ${className} 没有匹配到任何方法`);
        }
      }

      return { selectedMethods };
    } catch (error) {
      console.error("向量匹配分析工具类方法失败:", error);
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
   * 获取框架规范的详细说明（仅通过远程API）
   */
  async getFrameworkRuleDetails(question: string): Promise<string> {
    try {
      const knowledge = await this.getRemoteKnowledge(question);

      // 优先使用results中的内容
      if (knowledge.results && knowledge.results.length > 0) {
        const formattedResults = knowledge.results.map((result: any) => {
          if (typeof result === "string") {
            return result;
          } else if (result.content) {
            // 清理HTML标签，提取纯文本内容
            const cleanContent = result.content
              .replace(/<[^>]*>/g, " ") // 移除HTML标签
              .replace(/&nbsp;/g, " ") // 替换&nbsp;
              .replace(/\s+/g, " ") // 合并多个空格
              .trim();

            return `**${result.document_name || "框架文档"}**\n${cleanContent}`;
          } else {
            return JSON.stringify(result, null, 2);
          }
        });
        return formattedResults.join("\n\n");
      }

      // 如果没有results，使用answer
      if (knowledge.answer) {
        return knowledge.answer;
      }

      return `未找到关于"${question}"的详细说明，请查阅框架文档或联系技术支持。`;
    } catch (error) {
      console.error(
        `Error getting framework rule details for "${question}":`,
        error,
      );
      return `获取框架规范详情时发生错误。`;
    }
  }
}
