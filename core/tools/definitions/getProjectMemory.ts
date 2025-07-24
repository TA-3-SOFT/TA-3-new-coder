import { Tool } from "../../index.js";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn.js";

export const getProjectMemoryTool: Tool = {
  type: "function",
  displayTitle: "获取项目记忆",
  wouldLikeTo: "获取关于项目的长期记忆内容",
  isCurrently: "正在获取项目长期记忆",
  hasAlready: "已获取项目长期记忆内容",
  readonly: true,
  isInstant: false,
  group: "记忆管理工具",
  function: {
    name: BuiltInToolNames.GetProjectMemory,
    description:
      "根据用户输入获取项目相关的长期记忆内容，帮助理解项目历史和上下文信息。",
    parameters: {
      type: "object",
      properties: {
        userInput: {
          type: "string",
          description: "用户的输入内容，用于检索相关的项目记忆",
        },
      },
      required: ["userInput"],
    },
  },
};
