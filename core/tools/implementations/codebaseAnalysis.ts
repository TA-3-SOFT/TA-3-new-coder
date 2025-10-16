import { Chunk, ContextItem } from "../..";
import generateRepoMap from "../../util/generateRepoMap";
import { resolveRelativePathInDir } from "../../util/ideUtils";
import { renderChatMessage } from "../../util/messageContent";
import { ToolImpl } from ".";

export const codebaseAnalysisImpl: ToolImpl = async (args, extras) => {
  const { requirement } = args;
  // 验证参数
  if (!requirement || typeof requirement !== "string") {
    return [
      {
        name: "代码库分析错误",
        description: "参数验证失败",
        content: "requirement 参数必须是非空字符串",
      },
    ];
  }

  try {
    // 使用长上下文模型或默认模型
    const llm = extras.config?.selectedModelByRole?.longcontext ?? extras.llm;

    // 生成代码库地图
    const repoMap = await generateRepoMap(llm, extras.ide, {
      dirUris: undefined, // 分析整个代码库
      includeSignatures: false, // 不包含签名，只需要文件列表
      outputRelativeUriPaths: true, // 使用相对路径
    });

    // 构建提示词，让LLM分析并推荐相关文件
    const prompt = `${repoMap}

以上是代码库的文件结构图。你的任务是根据用户需求，分析并决定哪些文件最有可能与需求相关。

在给出答案之前，你应该先写出你的推理过程，说明哪些文件/文件夹最重要以及为什么。这个推理过程应该以 <reasoning> 标签开始，然后是一段解释你推理的段落，最后以 </reasoning> 标签结束。

在推理之后，你的响应应该以 <results> 标签开始，然后是每个文件的列表（每行一个文件），最后以 </results> 标签结束。你应该选择 5 到 10 个文件。你列出的文件名应该是你在代码库地图中看到的确切相对路径，而不仅仅是文件的基本名称。

用户需求：${requirement}`;

    // 调用LLM进行分析
    const response = await llm.chat(
      [
        { role: "user", content: prompt },
        { role: "assistant", content: "<reasoning>" },
      ],
      new AbortController().signal,
    );
    const content = renderChatMessage(response);

    // 解析LLM返回的文件列表
    if (!content.includes("\n")) {
      return [
        {
          name: "代码库分析结果",
          description: "分析失败",
          content: `LLM返回的内容错误`,
        },
      ];
    }

    const filepaths = content
      .split("<results>")[1]
      ?.split("</results>")[0]
      ?.split("\n")
      .filter(Boolean)
      .map((filepath) => filepath.trim());

    // 读取推荐的文件内容
    const chunks = await Promise.all(
      filepaths.map(async (filepath) => {
        const uri = await resolveRelativePathInDir(filepath, extras.ide);
        if (!uri) {
          return undefined;
        }
        try {
          const content = await extras.ide.readFile(uri);
          const lineCount = content.split("\n").length;
          const chunk: Chunk = {
            digest: uri,
            content,
            filepath: uri,
            endLine: lineCount - 1,
            startLine: 0,
            index: 0,
          };
          return chunk;
        } catch (error) {
          console.warn(`无法读取文件 ${uri}:`, error);
          return undefined;
        }
      }),
    );

    const validChunks = chunks.filter((c) => c !== undefined) as Chunk[];

    // 构建返回结果
    const resultContent = `# 代码库分析报告

## 分析需求
${requirement}

## 推荐文件详情

${validChunks
  .map(
    (chunk, index) => `### ${index + 1}. ${chunk.filepath}

\`\`\`
${chunk.content}
\`\`\`
`,
  )
  .join("\n")}
`;

    return [
      {
        name: "代码库分析结果",
        description: `找到 ${validChunks.length} 个相关文件`,
        content: resultContent,
      },
    ];
  } catch (error) {
    console.error("代码库分析失败:", error);
    return [
      {
        name: "代码库分析错误",
        description: "分析过程中发生错误",
        content: `分析失败: ${error instanceof Error ? error.message : String(error)}`,
      },
    ];
  }
};
