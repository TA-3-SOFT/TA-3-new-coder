import { Tool } from "../..";
import { BuiltInToolNames } from "../builtIn";

export const readFileRangeTool: Tool = {
  type: "function",
  displayTitle: "读取文件范围",
  wouldLikeTo: "读取 {{{ filepath }}} 的第 {{{ startLine }}} 到 {{{ endLine }}} 行",
  isCurrently: "正在读取 {{{ filepath }}} 的指定行范围",
  hasAlready: "已读取 {{{ filepath }}} 的指定行范围",
  readonly: true,
  isInstant: true,
  group: "项目分析工具", // 放在项目分析工具组下
  function: {
    name: BuiltInToolNames.ReadFileRange,
    description: "读取文件的指定行范围内容，用于精确获取文件的特定部分。支持指定起始行号和结束行号，结束行号为-1时表示读取到文件末尾。",
    parameters: {
      type: "object",
      required: ["filepath", "startLine", "endLine"],
      properties: {
        filepath: {
          type: "string",
          description: "要读取的文件路径，相对于工作空间根目录",
        },
        startLine: {
          type: "integer",
          description: "起始行号（从1开始）",
          minimum: 1,
        },
        endLine: {
          type: "integer", 
          description: "结束行号（从1开始），-1表示读取到文件末尾",
          minimum: -1,
        },
      },
    },
  },
};
