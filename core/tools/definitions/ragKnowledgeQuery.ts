import { Tool } from "../../index.js";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn.js";

export const ragKnowledgeQueryTool: Tool = {
  type: "function",
  displayTitle: "知识库查询检索",
  wouldLikeTo: "查询项目知识库中的相关知识",
  isCurrently: "正在查询项目知识库中的相关知识",
  hasAlready: "已完成项目知识库查询，获取了相关知识",
  readonly: true,
  isInstant: false,
  group: "知识库工具",
  function: {
    name: BuiltInToolNames.RagKnowledgeQuery,
    description:
      "查询项目的知识库，获取与查询内容相关的知识和文档。支持自然语言查询，可以查询开发规范、技术文档、需求文档、设计文档等项目相关知识。",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "要查询的内容，支持自然语言描述，如'如何使用某个工具类'、'项目的开发规范'、'项目中人员的字段是什么'等",
        },
        appid: {
          type: "string",
          description: "可选的知识库ID。如果不提供，将使用默认的组织ID",
        },
      },
      required: ["query"],
    },
  },
};
