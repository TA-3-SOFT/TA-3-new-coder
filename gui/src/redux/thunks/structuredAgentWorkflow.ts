import { createAsyncThunk } from "@reduxjs/toolkit";
import { JSONContent } from "@tiptap/core";
import {
  ContextItem,
  StructuredAgentStepType,
  StructuredAgentWorkflowState,
} from "core";
import { BuiltInToolNames } from "core/tools/builtIn";
import { ThunkApiType } from "../store";
import {
  resetStructuredAgentWorkflow,
  setStructuredAgentUserFeedback,
  setStructuredAgentWaitingForConfirmation,
  startStructuredAgentWorkflow,
  stopStructuredAgentWorkflow,
  updateStructuredAgentStep,
} from "../slices/sessionSlice";
import { streamResponseThunk } from "./streamResponse";
import { findToolCall } from "../util";

let requirementFinal: string | null = null;
// 工作流程步骤配置
let WORKFLOW_STEPS: Array<{
  step: StructuredAgentStepType;
  title: string;
  systemPrompt: () => string;
  needsConfirmation: boolean;
  allowedTools?: string[]; // 该步骤允许使用的工具名称列表
}> = [
  {
    step: "requirement-breakdown",
    title: "需求拆分",
    systemPrompt:
      () => `你是一个很有用的软件需求设计分析助手，你能帮助用户按照他提供的需求设计进行拆解和分析。

## 你的任务如下：
1. 如果是复杂需求和设计，请将需求分解为子需求和设计，需求和设计一一对应。
2. 如果需求设计中不太明确的地方，请将疑问记下来并问用户。
3. 每个子需求和设计需要完整，逻辑清晰，可以实现。
4. 请将子需求以要求的格式输出，方便我后续使用。
5. 如果没有必要分解，就不要分解。
6. 如果不需要进一步分解，直接整理成一个输出。
7. 不要调用任何tools工具


## 参考格式

子需求1
1. 功能需求
1.1 核心业务流程
1.2 关键业务规则
1.3 具体场景示例
2. 需求设计
2.1 库表
2.2 接口
2.3 三方依赖
---
子需求2
1. 功能需求
1.1 核心业务流程
1.2 关键业务规则
1.3 具体场景示例
2. 需求设计
2.1 库表
2.2 接口
2.3 三方依赖


回答完成后请输出以下固定格式：
***【用户操作】***：✅ **步骤完成，等待您的确认**

请在输入框中输入：
"确认"继续流程下一步，或输入具体的调整建议`,
    needsConfirmation: true,
    allowedTools: [], // 需求拆分步骤不使用任何工具
  },
  {
    step: "project-understanding",
    title: "项目理解",
    systemPrompt: () => `详细需求如下:
---
${requirementFinal}
---

你是一名资深软件设计工程师，基于上面的详细需求，了解项目结构相关知识。要求：
1. 使用project_analysis工具来分析当前Maven项目的结构，禁止传递任何参数给该工具（都使用默认的）。
2. 调用project_analysis工具后，根据结果总结回答，不要再调用其他tools了。

回答完成后请输出以下固定格式：
***【用户操作】***：✅ **步骤完成，等待您的确认**

请在输入框中输入：
"确认"继续流程下一步，或输入具体的调整建议`,
    needsConfirmation: true,
    allowedTools: [BuiltInToolNames.ProjectAnalysis], // 项目理解步骤只允许使用项目分析工具
  },
  {
    step: "code-analysis",
    title: "代码分析",
    systemPrompt: () => `详细需求如下：
---
${requirementFinal}
---

你是一名资深软件设计工程师，基于上面的详细需求和用户给出的项目理解的结果，进行详细的代码分析。要求：
1. 使用code_chunk_analysis工具，基于用户给出的project_analysis结果，调用code_chunk_analysis工具，传入每个模块和每个模块下对应的所有推荐文件作为moduleFileMap参数，不要传入userRequest参数（使用默认的）分析推荐的每个模块下的代码文件
2. 例如：project_analysis返回的结果中有3个模块，每个模块下分别有5个推荐文件，则调用code_chunk_analysis工具，调用传入所有模块和推荐文件作为moduleFileMap参数，moduleFileMap格式：{"模块1": ["文件1.java（相对于模块路径）", "文件2.java（相对于模块路径）..."],"模块2": ["文件1.java（相对于模块路径）", "文件2.java（相对于模块路径）..."], "模块3": ["文件1.java（相对于模块路径）", "文件2.java（相对于模块路径）..."]}
3. 依次调用完code_chunk_analysis工具后，如果code_chunk_analysis调用成功，不要再调用其他tools了，根据结果代码分析，完成回答
4. 只管设计工作，不要完成代码编写这类开发工作

回答完成后请输出以下固定格式：
***【用户操作】***：✅ **步骤完成，等待您的确认**

请在输入框中输入：
"确认"继续流程下一步，或输入具体的调整建议`,
    needsConfirmation: true,
    allowedTools: [BuiltInToolNames.CodeChunkAnalysis], // 代码分析步骤只允许使用代码块分析工具
  },
  {
    step: "plan-creation",
    title: "制定计划",
    systemPrompt: () => `详细需求如下：
---
${requirementFinal}
---

你是一名资深软件开发设计工程师，基于上面的详细需求以及用户给出的代码分析结果制定详细的实施计划。要求：
1. 能实现所有需求的开发任务列表
2. 每个任务的具体实施步骤、相关文件修改的详细计划
3. 只管设计工作，不要完成代码编写这类开发工作

回答完成后请输出以下固定格式：
***【用户操作】***：✅ **步骤完成，等待您的确认**

请在输入框中输入：
"确认"继续流程下一步，或输入具体的调整建议`,
    needsConfirmation: true,
    allowedTools: [
      // 制定计划步骤允许使用只读工具来查看和分析代码
      BuiltInToolNames.ReadFile,
      BuiltInToolNames.GrepSearch,
      BuiltInToolNames.FileGlobSearch,
      BuiltInToolNames.LSTool,
      BuiltInToolNames.ViewDiff,
    ],
  },
  {
    step: "plan-execution",
    title: "执行计划",
    systemPrompt: () => `详细需求如下：
---
${requirementFinal}
---

你是一名资深软件开发工程师，基于上面的详细需求，和用户给出的实施计划。使用可用的工具来进行开发工作，要求：
1. 按照计划的顺序逐步实施
2. 使用编辑工具对每个文件进行精确的修改
3. 确保代码质量和一致性
4. 在关键节点进行验证

执行完成后做出总结，结束流程`,
    needsConfirmation: false,
    allowedTools: [
      // 执行计划步骤允许使用所有工具
      BuiltInToolNames.ReadFile,
      BuiltInToolNames.EditExistingFile,
      BuiltInToolNames.CreateNewFile,
      BuiltInToolNames.RunTerminalCommand,
      BuiltInToolNames.GrepSearch,
      BuiltInToolNames.FileGlobSearch,
      BuiltInToolNames.LSTool,
      BuiltInToolNames.ViewDiff,
      BuiltInToolNames.SearchWeb,
    ],
  },
];

// 启动结构化agent工作流程
export const startStructuredAgentWorkflowThunk = createAsyncThunk<
  void,
  { userInput: string; editorState?: JSONContent },
  ThunkApiType
>(
  "structuredAgent/start",
  async ({ userInput, editorState }, { dispatch, getState }) => {
    // 启动工作流程
    dispatch(startStructuredAgentWorkflow());

    // 开始第一步：需求拆分
    await dispatch(
      processStructuredAgentStepThunk({
        step: "requirement-breakdown",
        userInput,
        editorState,
      }),
    );
  },
);

// 处理工作流程步骤
export const processStructuredAgentStepThunk = createAsyncThunk<
  void,
  {
    step: StructuredAgentStepType;
    userInput?: string;
    userFeedback?: string;
    editorState?: JSONContent;
  },
  ThunkApiType
>(
  "structuredAgent/processStep",
  async (
    { step, userInput, userFeedback, editorState },
    { dispatch, getState },
  ) => {
    const state = getState();
    const workflow = state.session.structuredAgentWorkflow;

    // 找到当前步骤配置
    const stepConfig = WORKFLOW_STEPS.find((s) => s.step === step);
    if (!stepConfig) {
      console.error(`Unknown workflow step: ${step}`);
      return;
    }

    // 如果有用户反馈，先保存
    if (userFeedback) {
      dispatch(setStructuredAgentUserFeedback(userFeedback));
    }

    let promptPreamble = "";
    let userFeedbackContent;
    if (userInput && step === "requirement-breakdown") {
      promptPreamble = `用户需求：`;
    }
    if (userFeedback) {
      promptPreamble = `用户反馈：`;
      userFeedbackContent = promptPreamble + userFeedback;
    }

    if (step === "project-understanding") {
      requirementFinal =
        state.session.history[
          state.session.history.length - 1
        ].message.content.toString();
      // 如果requirementFinal包含"***用户操作***"，只取分隔符之前的内容
      if (requirementFinal && requirementFinal.includes("***【用户操作】***")) {
        const lastSeparatorIndex =
          requirementFinal.lastIndexOf("***【用户操作】***");
        requirementFinal = requirementFinal
          .substring(0, lastSeparatorIndex)
          .trim();
      }
    }

    // 如果是代码分析步骤，添加 project_analysis 的结果
    if (step === "code-analysis") {
      const projectAnalysisResult = getProjectToolResult(
        state.session.history,
        "project_analysis",
      );
      if (projectAnalysisResult) {
        promptPreamble += `## project_analysis 工具的分析结果：\n${projectAnalysisResult}\n\n`;
      }
    }

    if (step === "plan-creation") {
      const codeChunkAnalysisResult = getProjectToolResult(
        state.session.history,
        "code_chunk_analysis",
      );
      if (codeChunkAnalysisResult) {
        promptPreamble += `## 代码分析 的结果：\n${codeChunkAnalysisResult}\n\n`;
      }
    }

    if (step === "plan-execution") {
      let planResult =
        state.session.history[
          state.session.history.length - 1
        ].message.content.toString();
      if (planResult && planResult.includes("***【用户操作】***")) {
        const lastSeparatorIndex = planResult.lastIndexOf("***【用户操作】***");
        planResult = planResult.substring(0, lastSeparatorIndex).trim();
      }
      promptPreamble += `## 实施计划如下：\n${planResult}\n\n`;
    }

    // 构建用户消息内容（简洁的步骤说明）
    let finalEditorState: JSONContent;

    if (editorState && step === "requirement-breakdown") {
      // 使用原始的 editorState，保留 @ 符号选择的文件
      finalEditorState = editorState;
    } else if (userFeedback) {
      // 用户反馈，构建简单的文本内容
      finalEditorState = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: userFeedback,
              },
            ],
          },
        ],
      };
    } else {
      // 其他步骤，构建简单的步骤说明
      finalEditorState = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: `开始执行：${stepConfig.title}`,
              },
            ],
          },
        ],
      };
    }

    let updateData: Partial<StructuredAgentWorkflowState> = {};
    updateData.requirementFinal = requirementFinal || "";
    updateData.userFeedbackContent = userFeedbackContent;
    // 更新步骤状态
    const stepIndex = WORKFLOW_STEPS.findIndex((s) => s.step === step);
    dispatch(
      updateStructuredAgentStep({
        step,
        stepIndex: stepIndex + 1,
        data: updateData,
      }),
    );

    // 构建动态系统消息
    let dynamicSystemMessage = stepConfig.systemPrompt();

    // 开始流式响应
    await dispatch(
      streamResponseThunk({
        editorState: finalEditorState,
        modifiers: {
          useCodebase: false,
          noContext: true,
        },
        promptPreamble: promptPreamble,
        dynamicSystemMessage: dynamicSystemMessage,
      }),
    );

    // 如果需要确认，设置等待状态
    if (stepConfig.needsConfirmation) {
      // 延迟设置等待确认状态，确保流式输出完成
      setTimeout(() => {
        dispatch(setStructuredAgentWaitingForConfirmation(true));
      }, 1000);
    } else {
      // 自动进入下一步
      const nextStepIndex = stepIndex + 1;
      if (nextStepIndex < WORKFLOW_STEPS.length) {
        const nextStep = WORKFLOW_STEPS[nextStepIndex];
        setTimeout(() => {
          dispatch(
            processStructuredAgentStepThunk({
              step: nextStep.step,
            }),
          );
        }, 1000);
      } else {
        // 工作流程完成
        dispatch(resetStructuredAgentWorkflow());
      }
    }
  },
);

// 用户确认并继续下一步
export const confirmAndContinueWorkflowThunk = createAsyncThunk<
  void,
  { feedback?: string },
  ThunkApiType
>(
  "structuredAgent/confirmAndContinue",
  async ({ feedback }, { dispatch, getState }) => {
    const state = getState();
    const workflow = state.session.structuredAgentWorkflow;

    // 清除等待确认状态
    dispatch(setStructuredAgentWaitingForConfirmation(false));

    // 找到下一步
    const currentStepIndex = WORKFLOW_STEPS.findIndex(
      (s) => s.step === workflow.currentStep,
    );
    const nextStepIndex = currentStepIndex + 1;

    if (nextStepIndex < WORKFLOW_STEPS.length) {
      const nextStep = WORKFLOW_STEPS[nextStepIndex];
      await dispatch(
        processStructuredAgentStepThunk({
          step: nextStep.step,
          userFeedback: feedback,
        }),
      );
    } else {
      // 工作流程完成
      dispatch(resetStructuredAgentWorkflow());
    }
  },
);

// 重新处理当前步骤（用于用户提供修改建议时）
export const retryCurrentStepThunk = createAsyncThunk<
  void,
  { feedback: string },
  ThunkApiType
>(
  "structuredAgent/retryCurrentStep",
  async ({ feedback }, { dispatch, getState }) => {
    const state = getState();
    const workflow = state.session.structuredAgentWorkflow;

    // 清除等待确认状态
    dispatch(setStructuredAgentWaitingForConfirmation(false));

    // 重新处理当前步骤，带上用户反馈
    await dispatch(
      processStructuredAgentStepThunk({
        step: workflow.currentStep,
        userFeedback: feedback,
      }),
    );
  },
);

// 处理结构化agent模式下的用户输入
export const handleStructuredAgentUserInputThunk = createAsyncThunk<
  boolean, // 返回是否已处理
  { userInput: string },
  ThunkApiType
>(
  "structuredAgent/handleUserInput",
  async ({ userInput }, { dispatch, getState }) => {
    const state = getState();
    const workflow = state.session.structuredAgentWorkflow;

    // 只在结构化agent模式且工作流程激活且等待确认时处理
    if (!workflow.isActive || !workflow.isWaitingForConfirmation) {
      return false;
    }

    const trimmedInput = userInput.trim().toLowerCase();

    // 检测确认指令
    const confirmKeywords = [
      "确认",
      "confirm",
      "ok",
      "yes",
      "继续",
      "continue",
      "下一步",
    ];
    const isConfirm = confirmKeywords.some(
      (keyword) => trimmedInput === keyword || trimmedInput.includes(keyword),
    );

    if (isConfirm) {
      // 用户确认，继续下一步
      await dispatch(confirmAndContinueWorkflowThunk({}));
      return true;
    } else {
      // 用户提供了建议或修改意见，重新处理当前步骤
      await dispatch(retryCurrentStepThunk({ feedback: userInput }));
      return true;
    }
  },
);

// 停止结构化agent工作流程
export const stopStructuredAgentWorkflowThunk = createAsyncThunk<
  void,
  void,
  ThunkApiType
>("structuredAgent/stop", async (_, { dispatch }) => {
  // 停止工作流程并重置状态
  dispatch(stopStructuredAgentWorkflow());
});

// 获取当前步骤信息
export const getCurrentStepInfo = (step: StructuredAgentStepType) => {
  return WORKFLOW_STEPS.find((s) => s.step === step);
};

// 获取指定工具调用的返回结果
export const getToolCallResult = (
  history: any[],
  toolName: string,
): ContextItem[][] | null => {
  // 从历史记录中查找最近的指定工具调用
  let result = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const historyItem = history[i];
    if (
      historyItem.message?.role === "assistant" &&
      historyItem.message?.toolCalls
    ) {
      for (const toolCall of historyItem.message.toolCalls) {
        if (toolCall.function.name === toolName) {
          const toolCallState = findToolCall(history, toolCall.id);
          if (toolCallState && toolCallState.output) {
            result.push(toolCallState.output);
          }
        }
      }
    }
  }
  return result.length > 0 ? result : null;
};

// 获取项目工具调用的返回结果
export const getProjectToolResult = (
  history: any[],
  toolName: string,
): string | null => {
  let contextItems = getToolCallResult(history, toolName);
  let result = "";
  // 遍历contextItem
  if (contextItems) {
    for (const contextItem of contextItems) {
      if (!contextItem || contextItem.length === 0) {
        continue;
      }

      const analysisResult = contextItem[0];
      if (!analysisResult || !analysisResult.content) {
        continue;
      }
      result += analysisResult.content + "\n\n";
    }
  }
  return result;
};
