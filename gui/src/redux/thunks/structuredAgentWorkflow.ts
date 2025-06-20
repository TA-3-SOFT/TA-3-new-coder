import { createAsyncThunk } from "@reduxjs/toolkit";
import { JSONContent } from "@tiptap/core";
import { StructuredAgentStepType, ContextItem } from "core";
import { ThunkApiType } from "../store";
import {
  setStructuredAgentWaitingForConfirmation,
  startStructuredAgentWorkflow,
  updateStructuredAgentStep,
  setStructuredAgentUserFeedback,
  resetStructuredAgentWorkflow,
  stopStructuredAgentWorkflow,
} from "../slices/sessionSlice";
import { streamResponseThunk } from "./streamResponse";
import { findToolCall } from "../util";

// 工作流程步骤配置
const WORKFLOW_STEPS: Array<{
  step: StructuredAgentStepType;
  title: string;
  systemPrompt: string;
  needsConfirmation: boolean;
}> = [
  {
    step: "requirement-breakdown",
    title: "需求拆分",
    systemPrompt: `你是一名资深AI开发工程师，请将用户给出的复杂需求拆解为可独立执行的子需求，要求：
1.子需求不要超过5个
2.每个子需求简单明了
3.不要调用任何tools工具

回答完成后请输出以下固定格式：
---
✅ **步骤完成，等待您的确认**

请在输入框中输入：
"确认"继续流程下一步，或输入具体的调整建议`,
    needsConfirmation: true,
  },
  {
    step: "project-understanding",
    title: "项目理解",
    systemPrompt: `你是一名资深AI开发工程师，基于拆分的子需求，深入了解项目结构和相关知识。要求：
1. 使用project_analysis工具来分析当前Maven项目的结构。
2. 如果project_analysis工具分析项目成功，就完成回答

回答完成后请输出以下固定格式：
---
✅ **步骤完成，等待您的确认**

请在输入框中输入：
"确认"继续流程下一步，或输入具体的调整建议`,
    needsConfirmation: true,
  },
  {
    step: "code-analysis",
    title: "代码分析",
    systemPrompt: `你是一名资深AI开发工程师，基于拆分的子需求和对上一步项目的分析，进行详细的代码分析。要求：
1. 使用code_chunk_analysis工具，基于上一步project_analysis结果，调用code_chunk_analysis工具，传入每个模块和每个模块下对应的所有推荐文件作为modules和files参数，依次分析推荐的每个模块下的代码文件
2. 例如：project_analysis返回的结果中有3个模块，每个模块下分别有5个推荐文件，则依次调用3次code_chunk_analysis工具，每次调用传入模块作为modules参数，传入模块下所有5个推荐文件作为files参数
3. 依次调用完code_chunk_analysis工具后即可完成代码分析

回答完成后请输出以下固定格式：
---
✅ **步骤完成，等待您的确认**

请在输入框中输入：
"确认"继续流程下一步，或输入具体的调整建议`,
    needsConfirmation: true,
  },
  {
    step: "plan-creation",
    title: "制定计划",
    systemPrompt: `你是一名资深AI开发工程师，基于前面的任务拆分，项目分析，代码分析制定详细的实施计划。要求：
1. 能实现目标的开发任务列表
2. 每个任务的具体实施步骤、文件修改的详细计划


回答完成后请输出以下固定格式：
---
✅ **步骤完成，等待您的确认**

请在输入框中输入：
"确认"继续流程下一步，或输入具体的调整建议`,
    needsConfirmation: true,
  },
  {
    step: "plan-execution",
    title: "执行计划",
    systemPrompt: `你是一名资深AI开发工程师，基于前面制定的实施计划。使用可用的工具来进行开发工作，要求：
1. 按照计划的顺序逐步实施
2. 使用编辑工具对每个文件进行精确的修改
3. 确保代码质量和一致性
4. 在关键节点进行验证

执行完成后做出总结，结束流程
`,
    needsConfirmation: false,
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

    // 更新步骤状态
    const stepIndex = WORKFLOW_STEPS.findIndex((s) => s.step === step);
    dispatch(
      updateStructuredAgentStep({
        step,
        stepIndex: stepIndex + 1,
      }),
    );

    // 如果有用户反馈，先保存
    if (userFeedback) {
      dispatch(setStructuredAgentUserFeedback(userFeedback));
    }

    // 构建动态系统消息
    let dynamicSystemMessage = stepConfig.systemPrompt;
    if (userInput && step === "requirement-breakdown") {
      dynamicSystemMessage += `\n\n用户需求：${userInput}`;
    }
    if (userFeedback) {
      dynamicSystemMessage += `\n\n用户反馈：${userFeedback}`;
    }

    // 如果是代码分析步骤，添加 project_analysis 的结果
    if (step === "code-analysis") {
      const projectAnalysisResult = getProjectAnalysisResult(
        state.session.history,
      );

      if (projectAnalysisResult) {
        const resultContent = extractProjectAnalysisData(projectAnalysisResult);
        if (resultContent) {
          dynamicSystemMessage += `\n\n## 上一步 project_analysis 工具的分析结果：\n${resultContent}`;
        }
      }
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

    // 开始流式响应
    await dispatch(
      streamResponseThunk({
        editorState: finalEditorState,
        modifiers: {
          useCodebase: false,
          noContext: true,
        },
        promptPreamble: dynamicSystemMessage + "\n",
        // dynamicSystemMessage,
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
): ContextItem[] | null => {
  // 从历史记录中查找最近的指定工具调用
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
            return toolCallState.output;
          }
        }
      }
    }
  }
  return null;
};

// 获取 project_analysis 工具调用的返回结果
export const getProjectAnalysisResult = (
  history: any[],
): ContextItem[] | null => {
  return getToolCallResult(history, "project_analysis");
};

// 从 project_analysis 结果中提取推荐的模块和文件信息
export const extractProjectAnalysisData = (contextItems: ContextItem[]) => {
  if (!contextItems || contextItems.length === 0) {
    return null;
  }

  const analysisResult = contextItems[0];
  if (!analysisResult || !analysisResult.content) {
    return null;
  }

  const content = analysisResult.content;

  return content;
};
