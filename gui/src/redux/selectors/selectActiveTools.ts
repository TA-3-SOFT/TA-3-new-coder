import { createSelector } from "@reduxjs/toolkit";
import { Tool } from "core";
import { RootState } from "../store";
import { BuiltInToolNames } from "core/tools/builtIn";

export const selectActiveTools = createSelector(
  [
    (store: RootState) => store.session.mode,
    (store: RootState) => store.config.config.tools,
    (store: RootState) => store.ui.toolSettings,
    (store: RootState) => store.ui.toolGroupSettings,
    (store: RootState) => store.config.config.keepToolCallsInChatMode,
  ],
  (mode, tools, policies, groupPolicies, keepToolCallsInChatMode): Tool[] => {
    if (mode === "chat") {
      // 如果启用了设置，则在Chat模式下也返回只读工具
      if (keepToolCallsInChatMode) {
        return tools.filter(
          (tool) =>
            policies[tool.function.name] !== "disabled" &&
            groupPolicies[tool.group] !== "exclude" &&
            isReadOnlyTool(tool),
        );
      } else {
        // 如果没有启用设置，则在Chat模式下不返回任何工具
        return [];
      }
    } else if (mode === "agent" || mode === "structured-agent") {
      return tools.filter(
        (tool) =>
          policies[tool.function.name] !== "disabled" &&
          groupPolicies[tool.group] !== "exclude",
      );
    } else {
      return [];
    }
  },
);

// 判断工具是否为只读工具
function isReadOnlyTool(tool: Tool): boolean {
  // 根据内置工具名称判断是否为只读工具
  const readOnlyToolNames = [
    BuiltInToolNames.ReadFile,
    BuiltInToolNames.ReadCurrentlyOpenFile,
    BuiltInToolNames.GrepSearch,
    BuiltInToolNames.FileGlobSearch,
    BuiltInToolNames.LSTool,
    BuiltInToolNames.ViewDiff,
  ];

  return (
    tool.readonly ||
    readOnlyToolNames.includes(tool.function.name as BuiltInToolNames)
  );
}
