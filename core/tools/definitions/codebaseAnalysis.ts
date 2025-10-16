import { Tool } from "../../index.js";
import { BuiltInToolNames } from "../builtIn.js";

export const codebaseAnalysis: Tool = {
  type: "function",
  displayTitle: "Codebase Analysis",
  wouldLikeTo: "分析 代码库codebase",
  isCurrently: "分析 代码库codebase",
  hasAlready: "分析完成 代码库codebase",
  readonly: true,
  isInstant: false,
  group: "代码库codebase分析工具",
  function: {
    name: BuiltInToolNames.CodebaseAnalysis,
    description: "分析代码库codebase，根据需求推荐相关的代码文件及代码片段。",
    parameters: {
      type: "object",
      properties: {
        requirement: {
          type: "string",
          description:
            "在代码库codebase中检索的需求，用于检索推荐相关文件和代码片段",
        },
      },
      required: ["requirement"],
    },
  },
};
