import { Tool } from "../../index.js";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn.js";

export const projectAnalysisTool: Tool = {
  type: "function",
  displayTitle: "Project Analysis",
  wouldLikeTo: "分析 Maven 项目结构",
  isCurrently: "分析 Maven 项目结构",
  hasAlready: "分析完成 Maven 项目结构",
  readonly: true,
  isInstant: false,
  group: "项目分析工具",
  function: {
    name: BuiltInToolNames.ProjectAnalysis,
    description:
      "分析Maven项目结构，提取模块信息，并根据需求推荐相关模块和文件。",
    parameters: {
      type: "object",
      properties: {
        workspaceDir: {
          type: "string",
          description: "要分析的工作空间目录路径（可选，默认使用当前工作空间）",
        },
        requirement: {
          type: "string",
          description:
            "原始需求拆分后的子需求，用于推荐相关的模块和文件（必选）",
        },
      },
      required: ["requirement"],
    },
  },
};
