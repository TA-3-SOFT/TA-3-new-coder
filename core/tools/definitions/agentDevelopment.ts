import { Tool } from "../../index.js";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn.js";

export const agentDevelopmentTool: Tool = {
  type: "function",
  displayTitle: "Ta+3 404开发指南",
  wouldLikeTo: "分析开发需求并提供框架指导",
  isCurrently: "分析开发需求并提供框架指导",
  hasAlready: "完成开发需求分析和框架指导",
  readonly: true,
  isInstant: false,
  group: "开发工具",
  function: {
    name: BuiltInToolNames.AgentDevelopment,
    description:
      "基于用户需求和开发计划，使用系统LLM分析并从Ta+3 404框架工具类中选择合适的工具类，提供完整的开发规范，并针对不清楚的规范生成具体提问，通过远程API获取详细的工具类方法定义和规范使用说明。",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};
