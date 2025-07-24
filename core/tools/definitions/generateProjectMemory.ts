import { Tool } from "../../index.js";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn.js";

export const generateProjectMemoryTool: Tool = {
  type: "function",
  displayTitle: "生成项目记忆",
  wouldLikeTo: "将当前对话生成长期记忆",
  isCurrently: "正在生成项目长期记忆",
  hasAlready: "已生成项目长期记忆",
  readonly: false,
  isInstant: false,
  group: "记忆管理工具",
  function: {
    name: BuiltInToolNames.GenerateProjectMemory,
    description:
      "将当前对话内容分析并生成项目相关的长期记忆，用于后续对话的上下文参考。",
    parameters: {
      type: "object",
      properties: {
        chatHistory: {
          type: "array",
          description: "聊天历史记录数组，包含当前对话的所有消息",
          items: {
            type: "object",
          },
        },
      },
      required: ["chatHistory"],
    },
  },
};
