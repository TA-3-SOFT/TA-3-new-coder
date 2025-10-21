import { Tool } from "../..";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export interface EditToolArgs {
  filepath: string;
  changes: string;
}

export const editFileTool: Tool = {
  type: "function",
  displayTitle: "Edit File",
  wouldLikeTo: "edit {{{ filepath }}}",
  isCurrently: "editing {{{ filepath }}}",
  hasAlready: "edited {{{ filepath }}}",
  group: BUILT_IN_GROUP_NAME,
  readonly: false,
  function: {
    name: BuiltInToolNames.EditExistingFile,
    description:
      "Use this tool to edit an existing file. If you don't know the contents of the file, read it first.When the tool is successfully called, it will return the latest complete content of the modified file.",
    parameters: {
      type: "object",
      required: ["filepath", "changes", "startLine", "endLine"],
      properties: {
        filepath: {
          type: "string",
          description:
            "The path of the file to edit, relative to the root of the workspace.",
        },
        changes: {
          type: "string",
          description:
            "对文件进行的任何修改，只显示必要的更改(包括需要新增，修改，删除的代码)。不要将其包装在代码块中。在较大的文件中，对未修改的大部分内容使用简洁的、语言适当的占位符，例如 '// ... existing code ...'",
        },
        startLine: {
          type: "number",
          description:
            "在最新文件版本中，当前changes内容相关的代码块的开始行号",
        },
        endLine: {
          type: "number",
          description:
            "在最新文件版本中，当前changes内容相关的代码块的结束行号",
        },
      },
    },
  },
};
