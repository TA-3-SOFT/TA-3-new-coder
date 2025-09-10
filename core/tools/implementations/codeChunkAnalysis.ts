import { ToolImpl } from ".";
import { CodeSnippetAnalyzer } from "../../util/codeChunkAnalyzer.js";
// import { CodeVectorAnalyzer } from "../../util/codeVectorAnalyzer.js";

export const codeChunkAnalysisImpl: ToolImpl = async (args, extras) => {
  const {
    moduleFileMap,
    userRequest,
    topN = 10,
    batchSize = 15,
    maxChunkSize = 800,
  } = args;

  let finalUserRequest = extras.contextData?.requirementFinal || userRequest;
  const userFeedbackContent = extras.contextData?.userFeedbackContent;
  if (userFeedbackContent) {
    finalUserRequest += `\n\n用户反馈：${userFeedbackContent}`;
  }

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

    // 使用longcontext模型而不是默认的extras.llm
    const longContextLLM = extras.config?.selectedModelByRole?.longcontext;
    analyzer = new CodeSnippetAnalyzer(extras.ide, longContextLLM || extras.llm, maxChunkSize);
    methodUsed = longContextLLM ? "LLM语义分析 (longcontext模型)" : "LLM语义分析";

    // 调用分析器
    let snippets;

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
