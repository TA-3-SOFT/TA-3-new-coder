import { createSelector } from "@reduxjs/toolkit";
import { Tool, StructuredAgentWorkflowState } from "core";
import { RootState } from "../store";
import { BuiltInToolNames } from "core/tools/builtIn";
import { getCurrentStepInfo } from "../thunks/structuredAgentWorkflow";

export const selectActiveTools = createSelector(
  [
    (store: RootState) => store.session.mode,
    (store: RootState) => store.config.config.tools,
    (store: RootState) => store.ui.toolSettings,
    (store: RootState) => store.ui.toolGroupSettings,
    (store: RootState) => store.config.config.keepToolCallsInChatMode,
    (store: RootState) => store.session.structuredAgentWorkflow,
  ],
  (
    mode,
    tools,
    policies,
    groupPolicies,
    keepToolCallsInChatMode,
    structuredAgentWorkflow,
  ): Tool[] => {
    if (mode === "chat") {
      // 如果启用了设置，则在Chat模式下也返回只读工具
      if (keepToolCallsInChatMode) {
        return tools.filter(
          (tool) =>
            policies[tool.function.name] !== "disabled" &&
            groupPolicies[tool.group] !== "exclude" &&
            isModeTool(tool, mode),
        );
      } else {
        // 如果没有启用设置，则在Chat模式下不返回任何工具
        return [];
      }
    } else if (mode === "agent") {
      return tools.filter(
        (tool) =>
          policies[tool.function.name] !== "disabled" &&
          groupPolicies[tool.group] !== "exclude" &&
          isModeTool(tool, mode),
      );
    } else if (mode === "structured-agent") {
      // 结构化智能体模式：根据当前步骤返回允许的工具
      return getStructuredAgentStepTools(
        tools,
        policies,
        groupPolicies,
        structuredAgentWorkflow,
      );
    } else {
      return [];
    }
  },
);

// 获取结构化智能体步骤允许的工具
function getStructuredAgentStepTools(
  tools: Tool[],
  policies: Record<string, string>,
  groupPolicies: Record<string, string>,
  structuredAgentWorkflow: StructuredAgentWorkflowState,
): Tool[] {
  // 如果工作流程未激活，返回所有工具（兜底逻辑）
  if (!structuredAgentWorkflow.isActive) {
    return tools.filter(
      (tool) =>
        policies[tool.function.name] !== "disabled" &&
        groupPolicies[tool.group] !== "exclude",
    );
  }

  // 获取当前步骤配置
  const stepConfig = getCurrentStepInfo(structuredAgentWorkflow.currentStep);
  if (!stepConfig || !stepConfig.allowedTools) {
    // 如果没有配置允许的工具，返回所有工具（兜底逻辑）
    return tools.filter(
      (tool) =>
        policies[tool.function.name] !== "disabled" &&
        groupPolicies[tool.group] !== "exclude",
    );
  }

  // 根据步骤配置过滤工具
  return tools.filter(
    (tool) =>
      policies[tool.function.name] !== "disabled" &&
      groupPolicies[tool.group] !== "exclude" &&
      stepConfig.allowedTools!.includes(tool.function.name),
  );
}

// 判断工具是否为只读工具
function isModeTool(tool: Tool, mode: string): boolean {
  if (mode === "chat") {
    const chatToolNames = [
      BuiltInToolNames.ReadFile,
      BuiltInToolNames.ReadCurrentlyOpenFile,
      BuiltInToolNames.GrepSearch,
      BuiltInToolNames.FileGlobSearch,
      BuiltInToolNames.LSTool,
      BuiltInToolNames.ViewDiff,
      BuiltInToolNames.CodebaseAnalysis,
      BuiltInToolNames.RagKnowledgeQuery,
      BuiltInToolNames.GetProjectMemory,
    ];
    return chatToolNames.includes(tool.function.name as BuiltInToolNames);
  } else if (mode === "agent") {
    const agentToolNames = [
      BuiltInToolNames.ReadFile,
      BuiltInToolNames.ReadCurrentlyOpenFile,
      BuiltInToolNames.GrepSearch,
      BuiltInToolNames.FileGlobSearch,
      BuiltInToolNames.LSTool,
      BuiltInToolNames.ViewDiff,
      BuiltInToolNames.CodebaseAnalysis,
      BuiltInToolNames.RagKnowledgeQuery,
      BuiltInToolNames.GetProjectMemory,
      BuiltInToolNames.EditExistingFile,
      BuiltInToolNames.CreateNewFile,
      BuiltInToolNames.RunTerminalCommand,
    ];
    return agentToolNames.includes(tool.function.name as BuiltInToolNames);
  } else {
    return false;
  }
}
