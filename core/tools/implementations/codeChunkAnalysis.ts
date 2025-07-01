import { ToolImpl } from ".";
import { CodeSnippetAnalyzer } from "../../util/codeChunkAnalyzer.js";
// import { CodeVectorAnalyzer } from "../../util/codeVectorAnalyzer.js";

export const codeChunkAnalysisImpl: ToolImpl = async (args, extras) => {
  const {
    moduleFileMap,
    userRequest,
    topN = 5,
    batchSize = 10,
    maxChunkSize = 2000,
    analysisMethod = "auto",
    useKeywordMatching,
  } = args;

  const finalUserRequest = extras.contextData?.requirementFinal || userRequest;

  try {
    // 验证参数
    if (
      !moduleFileMap ||
      typeof moduleFileMap !== "object" ||
      Object.keys(moduleFileMap).length === 0
    ) {
      return [
        {
          name: "代码片段分析错误",
          description: "参数验证失败",
          content:
            'moduleFileMap 参数必须是非空对象，格式：{"模块路径": ["文件1", "文件2"]}',
        },
      ];
    }

    if (!finalUserRequest || typeof finalUserRequest !== "string") {
      return [
        {
          name: "代码片段分析错误",
          description: "参数验证失败",
          content: "finalUserRequest 参数必须是非空字符串",
        },
      ];
    }

    // 根据分析方法选择分析器
    // let analyzer: CodeSnippetAnalyzer | CodeVectorAnalyzer;
    let analyzer: CodeSnippetAnalyzer;
    let methodUsed: string;

    // 获取嵌入提供者
    const embeddingsProvider = extras.config?.selectedModelByRole?.embed;

    // if (analysisMethod === "vector") {
    //   if (!embeddingsProvider) {
    //     return [
    //       {
    //         name: "代码片段分析错误",
    //         description: "向量化方法需要嵌入提供者",
    //         content:
    //           "向量化分析方法需要配置嵌入模型。请在配置中设置 embeddingsProvider。",
    //       },
    //     ];
    //   }
    //   analyzer = new CodeVectorAnalyzer(
    //     extras.ide,
    //     embeddingsProvider,
    //     extras.llm,
    //     maxChunkSize,
    //   );
    //   methodUsed = "向量化匹配";
    // } else if (analysisMethod === "llm") {
    //   analyzer = new CodeSnippetAnalyzer(extras.ide, extras.llm, maxChunkSize);
    //   methodUsed = "LLM语义分析";
    // } else {
    //   // auto: 根据需求复杂度自动选择
    //   if (
    //     (finalUserRequest.length > 100 ||
    //       finalUserRequest.split(/[，。,\.]/).length > 3) &&
    //     embeddingsProvider
    //   ) {
    //     analyzer = new CodeVectorAnalyzer(
    //       extras.ide,
    //       embeddingsProvider,
    //       extras.llm,
    //       maxChunkSize,
    //     );
    //     methodUsed = "向量化匹配（自动选择）";
    //   } else {
    //     analyzer = new CodeSnippetAnalyzer(
    //       extras.ide,
    //       extras.llm,
    //       maxChunkSize,
    //     );
    //     methodUsed = "LLM语义分析（自动选择）";
    //   }
    // }

    analyzer = new CodeSnippetAnalyzer(extras.ide, extras.llm, maxChunkSize);
    methodUsed = "LLM语义分析";

    // 调用分析器
    let snippets;
    // if (analyzer instanceof CodeVectorAnalyzer) {
    //   snippets = await analyzer.getRelevantSnippets(
    //     moduleFileMap,
    //     finalUserRequest,
    //     topN,
    //     batchSize,
    //     useKeywordMatching,
    //   );
    // } else {
    //   snippets = await analyzer.getRelevantSnippets(
    //     moduleFileMap,
    //     finalUserRequest,
    //     topN,
    //     batchSize,
    //   );
    // }

    snippets = await analyzer.getRelevantSnippets(
      moduleFileMap,
      finalUserRequest,
      topN,
      batchSize,
    );

    if (!snippets.length) {
      const moduleList = Object.keys(moduleFileMap);
      const fileList = Object.values(moduleFileMap).flat();
      return [
        {
          name: "代码片段分析结果",
          description: "未找到相关代码片段",
          content: `根据需求在指定的模块和文件中未找到相关的代码片段。\n\n分析方法: ${methodUsed}\n分析的模块: ${moduleList.join(", ")}\n分析的文件: ${fileList.join(", ")}`,
        },
      ];
    }

    // 构建结果内容
    const moduleList = Object.keys(moduleFileMap);
    const fileList = Object.values(moduleFileMap).flat();

    let content = `# 代码片段相关性分析报告\n\n`;
    // content += `**用户需求:** ${finalUserRequest}\n\n`;
    content += `**分析方法:** ${methodUsed}\n\n`;
    content += `**分析范围:**\n`;
    content += `- 模块: ${moduleList.join(", ")}\n`;
    content += `- 文件: ${fileList.join(", ")}\n\n`;
    content += `**找到 ${snippets.length} 个相关代码片段:**\n\n`;

    snippets.forEach((snippet, index) => {
      content += `## 代码片段 #${index + 1}\n\n`;
      content += `**文件:** ${snippet.file}\n`;
      content += `**起始行:** ${snippet.start_line}\n`;
      content += `**相关性评分:** ${snippet.score.toFixed(2)}/10\n\n`;
      content += `**代码内容:**\n`;
      content += `\`\`\`java\n${snippet.code}\n\`\`\`\n\n`;
      content += `---\n\n`;
    });

    // 输出content
    console.log(content);

    return [
      {
        name: "代码片段相关性分析报告",
        description: "根据用户需求分析的最相关代码片段",
        content,
      },
    ];
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return [
      {
        name: "代码片段分析错误",
        description: "代码片段分析过程中发生错误",
        content: `分析代码片段时发生错误: ${errorMessage}`,
      },
    ];
  }
};
