import { Tool } from "../../index.js";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn.js";

export const codeChunkAnalysisTool: Tool = {
  type: "function",
  displayTitle: "Code Chunk Analysis",
  wouldLikeTo: "分析代码片段相关性",
  isCurrently: "分析代码片段相关性",
  hasAlready: "分析完成代码片段相关性",
  readonly: true,
  isInstant: false,
  group: "项目分析工具",
  function: {
    name: BuiltInToolNames.CodeChunkAnalysis,
    description:
      "分析代码片段的相关性，根据用户需求从指定模块和文件中提取最相关的代码片段。",
    parameters: {
      type: "object",
      properties: {
        modules: {
          type: "array",
          items: {
            type: "string",
          },
          description: "要分析的模块",
        },
        files: {
          type: "array",
          items: {
            type: "string",
          },
          description: "要分析的文件列表（相对于模块路径）",
        },
        userRequest: {
          type: "string",
          description: "完整的详细需求，用于评估代码片段的相关性",
        },
        topN: {
          type: "number",
          description: "返回的最相关代码片段数量（默认5）",
          default: 5,
        },
        batchSize: {
          type: "number",
          description: "批处理大小（默认10）",
          default: 10,
        },
        maxChunkSize: {
          type: "number",
          description: "代码块最大大小（默认2000字符）",
          default: 2000,
        },
      },
      required: ["modules", "files", "userRequest"],
    },
  },
};
