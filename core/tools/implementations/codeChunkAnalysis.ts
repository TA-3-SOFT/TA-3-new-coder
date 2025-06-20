import { ToolImpl } from ".";
import { CodeSnippetAnalyzer } from "../../util/codeChunkAnalyzer.js";

export const codeChunkAnalysisImpl: ToolImpl = async (args, extras) => {
  const {
    modules,
    files,
    userRequest,
    topN = 5,
    batchSize = 10,
    maxChunkSize = 2000,
  } = args;

  try {
    const analyzer = new CodeSnippetAnalyzer(
      extras.ide,
      extras.llm,
      maxChunkSize,
    );

    // 验证参数
    if (!modules || !Array.isArray(modules) || modules.length === 0) {
      return [
        {
          name: "代码片段分析错误",
          description: "参数验证失败",
          content: "modules 参数必须是非空数组",
        },
      ];
    }

    if (!files || !Array.isArray(files) || files.length === 0) {
      return [
        {
          name: "代码片段分析错误",
          description: "参数验证失败",
          content: "files 参数必须是非空数组",
        },
      ];
    }

    if (!userRequest || typeof userRequest !== "string") {
      return [
        {
          name: "代码片段分析错误",
          description: "参数验证失败",
          content: "userRequest 参数必须是非空字符串",
        },
      ];
    }

    const snippets = await analyzer.getRelevantSnippets(
      modules,
      files,
      userRequest,
      topN,
      batchSize,
    );

    if (!snippets.length) {
      return [
        {
          name: "代码片段分析结果",
          description: "未找到相关代码片段",
          content: `根据需求 "${userRequest}" 在指定的模块和文件中未找到相关的代码片段。\n\n分析的模块: ${modules.join(", ")}\n分析的文件: ${files.join(", ")}`,
        },
      ];
    }

    // 构建结果内容
    let content = `# 代码片段相关性分析报告\n\n`;
    content += `**用户需求:** ${userRequest}\n\n`;
    content += `**分析范围:**\n`;
    content += `- 模块: ${modules.join(", ")}\n`;
    content += `- 文件: ${files.join(", ")}\n\n`;
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
