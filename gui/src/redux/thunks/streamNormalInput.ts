import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";
import { ChatMessage, LLMFullCompletionOptions } from "core";
import { modelSupportsTools } from "core/llm/autodetect";
import { ToCoreProtocol } from "core/protocol";
import { selectActiveTools } from "../selectors/selectActiveTools";
import { selectCurrentToolCall } from "../selectors/selectCurrentToolCall";
import { selectSelectedChatModel } from "../slices/configSlice";
import {
  abortStream,
  addPromptCompletionPair,
  setToolGenerated,
  streamUpdate,
  updateHistoryItemAtIndex,
} from "../slices/sessionSlice";
import { ThunkApiType } from "../store";
import { callCurrentTool } from "./callCurrentTool";
import { getProjectToolResult } from "./structuredAgentWorkflow";

export const streamNormalInput = createAsyncThunk<
  void,
  {
    messages: ChatMessage[];
    legacySlashCommandData?: ToCoreProtocol["llm/streamChat"][0]["legacySlashCommandData"];
  },
  ThunkApiType
>(
  "chat/streamNormalInput",
  async (
    { messages, legacySlashCommandData },
    { dispatch, extra, getState },
  ) => {
    // Gather state
    const state = getState();
    const selectedChatModel = selectSelectedChatModel(state);

    const streamAborter = state.session.streamAborter;
    if (!selectedChatModel) {
      throw new Error("Default model not defined");
    }

    let completionOptions: LLMFullCompletionOptions = {};
    const activeTools = selectActiveTools(state);
    const toolsSupported = modelSupportsTools(selectedChatModel);
    if (toolsSupported && activeTools.length > 0) {
      completionOptions = {
        tools: activeTools,
      };
    }

    // Send request
    const gen = extra.ideMessenger.llmStreamChat(
      {
        completionOptions,
        title: selectedChatModel.title,
        messages,
        legacySlashCommandData,
      },
      streamAborter.signal,
    );

    // Stream response
    let next = await gen.next();
    while (!next.done) {
      if (!getState().session.isStreaming) {
        dispatch(abortStream());
        break;
      }

      dispatch(streamUpdate(next.value));
      next = await gen.next();
    }

    // Attach prompt log and end thinking for reasoning models
    if (next.done && next.value) {
      dispatch(addPromptCompletionPair([next.value]));

      try {
        if (state.session.mode === "chat" || state.session.mode === "agent") {
          extra.ideMessenger.post("devdata/log", {
            name: "chatInteraction",
            data: {
              prompt: next.value.prompt,
              completion: next.value.completion,
              modelProvider: selectedChatModel.underlyingProviderName,
              modelTitle: selectedChatModel.title,
              sessionId: state.session.id,
            },
          });
        }
        // else if (state.session.mode === "edit") {
        //   extra.ideMessenger.post("devdata/log", {
        //     name: "editInteraction",
        //     data: {
        //       prompt: next.value.prompt,
        //       completion: next.value.completion,
        //       modelProvider: selectedChatModel.provider,
        //       modelTitle: selectedChatModel.title,
        //     },
        //   });
        // }
      } catch (e) {
        console.error("Failed to send dev data interaction log", e);
      }
    }

    // If it's a tool call that is automatically accepted, we should call it
    const newState = getState();
    const toolSettings = newState.ui.toolSettings;
    const fullyAutomaticEditMode = newState.config.config.ui?.fullyAutomaticEditMode ?? false;
    const toolCallState = selectCurrentToolCall(newState);
    if (toolCallState) {
      dispatch(
        setToolGenerated({
          toolCallId: toolCallState.toolCallId,
        }),
      );

      // In fully automatic edit mode, auto-call all tools
      // Otherwise, only auto-call tools marked as "allowedWithoutPermission"
      if (
        fullyAutomaticEditMode ||
        toolSettings[toolCallState.toolCall.function.name] ===
        "allowedWithoutPermission"
      ) {
        const response = await dispatch(callCurrentTool());
        unwrapResult(response);

        // 特殊处理：如果是 project_analysis 工具，等待工具完成后替换AI输出
        if (toolCallState.toolCall.function.name === "project_analysis") {
          console.log("🔍 检测到 project_analysis 工具调用，准备替换AI输出");

          // 等待工具调用完成
          await new Promise((resolve) => setTimeout(resolve, 0));

          // 获取工具结果
          const updatedState = getState();
          const projectAnalysisResult = getProjectToolResult(
            updatedState.session.history,
            "project_analysis",
          );

          if (projectAnalysisResult && projectAnalysisResult.trim()) {
            console.log("✅ 获取到 project_analysis 工具结果，替换AI输出");

            // 找到最后一条assistant消息
            const history = updatedState.session.history;
            let lastAssistantIndex = -1;
            for (let i = history.length - 1; i >= 0; i--) {
              if (history[i].message.role === "assistant") {
                lastAssistantIndex = i;
                break;
              }
            }

            if (lastAssistantIndex !== -1) {
              // 添加用户操作提示
              const enhancedContent = `${projectAnalysisResult}

---
***【用户操作】***：✅ **步骤完成，等待您的确认**

* 执行下一步：点击下方"确认"按钮进入下一步，或在输入框中输入："确认"。
* 调整回答内容：点击下方"编辑"按钮进入修改，或在输入框中输入具体的调整建议。`;

              // 直接更新消息内容
              dispatch(
                updateHistoryItemAtIndex({
                  index: lastAssistantIndex,
                  updates: {
                    message: {
                      ...history[lastAssistantIndex].message,
                      content: enhancedContent,
                    },
                  },
                }),
              );
            }
          }
        }
      }
    }
  },
);
