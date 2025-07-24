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
  ChatHistoryItemWithMessageId,
  resetStructuredAgentWorkflow,
  setStructuredAgentUserFeedback,
  setStructuredAgentWaitingForConfirmation,
  startStructuredAgentWorkflow,
  stopStructuredAgentWorkflow,
  updateStructuredAgentStep,
} from "../slices/sessionSlice";
import { streamResponseThunk } from "./streamResponse";
import { findToolCall } from "../util";
import { history } from "@headlessui/react/dist/utils/active-element-history";

let requirementFinal: string | null = null;
let projectMemory: string | null = null;
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
      () => `你是一个很有用的软件需求设计整理助手，你要靠整理需求挣钱来为你的母亲治病，你整理的需求约精确越好获得的收入越高，您的职责就是帮助用户分析和设计需求。


## 任务

- 理解需求，并按需求模板整理，如果用户需求很模糊，可适当完善。
- 需求理解和整理必须精确不能想当然。
- 如果用户没有按模版编写，并且是涉及多个模块的复杂需求，需分解复杂需求为子需求，子需求是可以抛开其它子需求独立运行的模块，不要将需求拆的太细。
- 在此过程中不使用任何外部工具。

## 当前项目已有记忆
${projectMemory}

## 需求模板

如果有子需求，每个“子需求”按以下格式整理：
<requirement_analysis>
<requirement_sub>
# **子需求 1**
  ## 1. 功能需求
    ### 1.1. 核心业务流程
    ### 1.2. 关键业务规则
    ### 1.3. 特定场景示例
</requirement_sub>
<requirement_sub>
# **子需求 2**
  ## 1. 功能需求
    ### 1.1. 核心业务流程
    ### 1.2. 关键业务规则
    ### 1.3. 特定场景示例
</requirement_sub>
</requirement_analysis>

没有就按照
<requirement_analysis>
<requirement_sub>
# **需求**
  ## 1. 功能需求
    ### 1.1. 核心业务流程
    ### 1.2. 关键业务规则
    ### 1.3. 特定场景示例
</requirement_sub>
</requirement_analysis>


在您的回复结尾使用以下固定格式：
---
***【用户操作】***：✅ **步骤完成，等待您的确认**\n
* 执行下一步：点击下方“确认”按钮进入下一步，或在输入框中输入："确认"。
* 调整回答内容：点击下方“编辑”按钮进入修改，或在输入框中输入具体的调整建议。`,
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
2. 调用project_analysis工具后，根据结果做出简单总结回答。

回答完成后请输出以下固定的完整内容：
---
***【用户操作】***：✅ **步骤完成，等待您的确认**\n
* 执行下一步：点击下方“确认”按钮进入下一步，或在输入框中输入："确认"。
* 调整回答内容：点击下方“编辑”按钮进入修改，或在输入框中输入具体的调整建议。`,
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
3. 依次调用完code_chunk_analysis工具后，如果code_chunk_analysis调用成功，根据调用结果做出简单总结回答
4. 只管设计工作，不要完成代码编写这类开发工作

回答完成后请输出以下固定的完整内容：
---
***【用户操作】***：✅ **步骤完成，等待您的确认**\n
* 执行下一步：点击下方“确认”按钮进入下一步，或在输入框中输入："确认"。
* 调整回答内容：点击下方“编辑”按钮进入修改，或在输入框中输入具体的调整建议。`,
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
4. 设计计划之前先调用'agent_development'工具查看项目开发可能用到的工具类和开发规范

回答完成后请输出以下固定的完整内容：
---
***【用户操作】***：✅ **步骤完成，等待您的确认**\n
* 执行下一步：点击下方“确认”按钮进入下一步，或在输入框中输入："确认"。
* 调整回答内容：点击下方“编辑”按钮进入修改，或在输入框中输入具体的调整建议。`,
    needsConfirmation: true,
    allowedTools: [
      // 制定计划步骤允许使用只读工具来查看和分析代码
      BuiltInToolNames.ReadFile,
      BuiltInToolNames.GrepSearch,
      BuiltInToolNames.FileGlobSearch,
      BuiltInToolNames.LSTool,
      BuiltInToolNames.ViewDiff,
      BuiltInToolNames.AgentDevelopment,
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

回答完成后请输出以下固定的完整内容：
---
***【用户操作】***：✅ **步骤完成，等待您的确认**\n
* 结束流程：点击下方“确认”按钮结束，或在输入框中输入："确认"。
* 继续执行：请在输入框中输入您的要求。`,
    needsConfirmation: true,
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
    { dispatch, getState, extra },
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
      try {
        const result = await extra.ideMessenger.request("tools/call", {
          toolCall: {
            id: `get_project_memory_${Date.now()}`,
            type: "function",
            function: {
              name: BuiltInToolNames.GetProjectMemory,
              arguments: JSON.stringify({
                userInput: userInput,
              }),
            },
          },
        });
        console.log("GetProjectMemory 工具调用结果:", result);

        // 处理返回结果，将其转换为字符串格式
        const formattedMemory = formatToolCallResult(result);
        console.log("格式化后的项目记忆:", formattedMemory);
        console.log("格式化后的项目记忆类型:", typeof formattedMemory);
        console.log("格式化后的项目记忆长度:", formattedMemory?.length);

        // 确保 formattedMemory 是字符串类型
        const memoryString =
          typeof formattedMemory === "string"
            ? formattedMemory
            : String(formattedMemory);
        console.log("转换为字符串后的记忆:", memoryString);

        // 如果有实际内容，使用它；否则使用默认提示
        if (
          memoryString &&
          memoryString.trim() &&
          memoryString !== "工具调用结果格式化失败"
        ) {
          projectMemory = memoryString;
          console.log("使用实际记忆内容，长度:", projectMemory.length);
        } else {
          projectMemory = "暂无相关项目记忆，这是一个新的项目分析。";
          console.log("使用默认记忆提示");
        }
      } catch (error) {
        console.error("获取项目记忆时出错:", error);
        projectMemory = "获取项目记忆时出现错误，将基于当前输入进行分析。";
      }
      promptPreamble = `用户需求：`;
    }
    if (userFeedback) {
      promptPreamble = `用户反馈：`;
      userFeedbackContent = promptPreamble + userFeedback;
    }

    if (step === "project-understanding") {
      requirementFinal = getSessionHistoryLastContent(state.session.history);
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
      // 直接调用 GenerateProjectMemory 工具
      const result = extra.ideMessenger.request("tools/call", {
        toolCall: {
          id: `generate_project_memory_${Date.now()}`,
          type: "function",
          function: {
            name: BuiltInToolNames.GenerateProjectMemory,
            arguments: JSON.stringify({
              chatHistory: state.session.history,
            }),
          },
        },
      });

      const planResult = getSessionHistoryLastContent(state.session.history);
      const codeChunkAnalysisResult = getProjectToolResult(
        state.session.history,
        "code_chunk_analysis",
      );
      promptPreamble += `## 实施计划如下：\n${planResult}\n\n ## 相关的代码片段如下：\n${codeChunkAnalysisResult}\n\n`;
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
    const confirmKeywords = ["确认", "confirm", "ok", "yes", "continue"];
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
  // let result = [];
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
            // result.push(toolCallState.output);
            return [toolCallState.output];
          }
        }
      }
    }
  }
  // return result.length > 0 ? result : null;
  return null;
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

// 格式化工具调用结果为字符串
export const formatToolCallResult = (result: any): string => {
  try {
    // 检查结果是否存在
    if (!result) {
      console.warn("formatToolCallResult: 结果为空");
      return "工具调用结果格式化失败";
    }

    // 处理可能的嵌套结构：result.content.contextItems 或 result.contextItems
    let contextItems;
    if (result.content && result.content.contextItems) {
      // 如果有 content 包装层
      contextItems = result.content.contextItems;
      console.log("formatToolCallResult: 使用 result.content.contextItems");
    } else if (result.contextItems) {
      // 直接的 contextItems
      contextItems = result.contextItems;
      console.log("formatToolCallResult: 使用 result.contextItems");
    } else {
      console.warn("formatToolCallResult: contextItems 字段不存在", result);
      return "工具调用结果格式化失败";
    }

    // 检查 contextItems 是否为数组
    if (!Array.isArray(contextItems)) {
      console.warn("formatToolCallResult: contextItems 不是数组", contextItems);
      return "工具调用结果格式化失败";
    }

    // 如果 contextItems 为空数组
    if (contextItems.length === 0) {
      console.log("formatToolCallResult: contextItems 为空数组");
      return "暂无相关项目记忆，这是一个新的项目分析。";
    }

    // 提取第一个 contextItem 的 content
    const firstContextItem = contextItems[0];
    if (!firstContextItem || typeof firstContextItem.content !== 'string') {
      console.warn("formatToolCallResult: 第一个 contextItem 无效或 content 不是字符串", firstContextItem);
      return "工具调用结果格式化失败";
    }

    // 返回格式化的内容
    const content = firstContextItem.content.trim();
    if (!content) {
      console.log("formatToolCallResult: content 为空字符串");
      return "暂无相关项目记忆，这是一个新的项目分析。";
    }

    console.log("formatToolCallResult: 成功格式化结果，内容长度:", content.length);
    return content;

  } catch (error) {
    console.error("formatToolCallResult: 格式化过程中发生错误:", error);
    return "工具调用结果格式化失败";
  }
};

// 获取会话历史最后一条信息
export const getSessionHistoryLastContent = (
  history: ChatHistoryItemWithMessageId[],
): string => {
  let result = history[history.length - 1].message.content.toString();
  if (result && result.includes("***【用户操作】***")) {
    const lastSeparatorIndex = result.lastIndexOf("***【用户操作】***");
    result = result.substring(0, lastSeparatorIndex).trim();
  }
  return result;
};
