import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";
import { ChatMessage } from "core";
import { constructMessages } from "core/llm/constructMessages";
import { renderContextItems } from "core/util/messageContent";
import { getBaseSystemMessage } from "../../util";
import { selectSelectedChatModel } from "../slices/configSlice";
import {
  addContextItemsAtIndex,
  setActive,
  streamUpdate,
} from "../slices/sessionSlice";
import { ThunkApiType } from "../store";
import { findToolCall } from "../util";
import { resetStateForNewMessage } from "./resetStateForNewMessage";
import { streamNormalInput } from "./streamNormalInput";
import { streamThunkWrapper } from "./streamThunkWrapper";
import { getCurrentStepInfo } from "./structuredAgentWorkflow";

export const streamResponseAfterToolCall = createAsyncThunk<
  void,
  { toolCallId: string },
  ThunkApiType
>(
  "chat/streamAfterToolCall",
  async ({ toolCallId }, { dispatch, getState }) => {
    await dispatch(
      streamThunkWrapper(async () => {
        const state = getState();
        const initialHistory = state.session.history;
        const selectedChatModel = selectSelectedChatModel(state);

        if (!selectedChatModel) {
          throw new Error("No model selected");
        }

        const toolCallState = findToolCall(state.session.history, toolCallId);

        if (!toolCallState) {
          throw new Error("Tool call not found");
        }

        const toolOutput = toolCallState.output ?? [];

        resetStateForNewMessage();

        await new Promise((resolve) => setTimeout(resolve, 0));

        const newMessage: ChatMessage = {
          role: "tool",
          content: renderContextItems(toolOutput),
          toolCallId,
        };
        dispatch(streamUpdate([newMessage]));
        dispatch(
          addContextItemsAtIndex({
            index: initialHistory.length,
            contextItems: toolOutput.map((contextItem) => ({
              ...contextItem,
              id: {
                providerTitle: "toolCall",
                itemId: toolCallId,
              },
            })),
          }),
        );

        dispatch(setActive());

        const updatedHistory = getState().session.history;
        const messageMode = getState().session.mode;

        const baseChatOrAgentSystemMessage = getBaseSystemMessage(
          selectedChatModel,
          messageMode,
        );

        // 获取动态系统消息（如果在结构化智能体模式下）
        let dynamicSystemMessage: string | undefined;
        if (messageMode === "structured-agent") {
          const workflow = getState().session.structuredAgentWorkflow;
          if (workflow.isActive) {
            const stepConfig = getCurrentStepInfo(workflow.currentStep);
            if (stepConfig) {
              dynamicSystemMessage = stepConfig.systemPrompt();
            }
          }
        }

        // 在结构化智能体模式下，每个步骤不包含历史记录，只使用当前消息
        let historyForMessages = [...updatedHistory];
        if (messageMode === "structured-agent") {
          const workflow = getState().session.structuredAgentWorkflow;
          const stepHistoryStartIndex = workflow.stepHistoryStartIndex;

          // 如果有步骤历史记录开始索引，从该索引开始到最后
          if (
            stepHistoryStartIndex !== undefined &&
            stepHistoryStartIndex >= 0
          ) {
            historyForMessages = updatedHistory.slice(stepHistoryStartIndex);
          }
          // else {
          //   // 兜底逻辑：找到最后一个role为user的消息的索引
          //   let lastUserIndex = -1;
          //   for (let i = updatedHistory.length - 1; i >= 0; i--) {
          //     if (updatedHistory[i].message.role === "user") {
          //       lastUserIndex = i;
          //       break;
          //     }
          //   }
          //
          //   // 如果找到了最后一个user消息，从该位置开始到最后
          //   if (lastUserIndex !== -1) {
          //     historyForMessages = updatedHistory.slice(lastUserIndex);
          //   }
          // }
        }

        const messages = constructMessages(
          messageMode,
          historyForMessages,
          baseChatOrAgentSystemMessage,
          state.config.config.rules,
          state.config.config, // 传入完整配置
          dynamicSystemMessage, // 传入动态系统消息
        );

        unwrapResult(await dispatch(streamNormalInput({ messages })));
      }),
    );
  },
);
