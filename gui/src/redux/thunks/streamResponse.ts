import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";
import { JSONContent } from "@tiptap/core";
import { InputModifiers, ToolResultChatMessage, UserChatMessage } from "core";
import { constructMessages } from "core/llm/constructMessages";
import { getApplicableRules } from "core/llm/rules/getSystemMessageWithRules";
import posthog from "posthog-js";
import { v4 as uuidv4 } from "uuid";
import { getBaseSystemMessage } from "../../util";
import { selectSelectedChatModel } from "../slices/configSlice";
import {
  setAppliedRulesAtIndex,
  submitEditorAndInitAtIndex,
  updateHistoryItemAtIndex,
} from "../slices/sessionSlice";
import { ThunkApiType } from "../store";
import { gatherContext } from "./gatherContext";
import { resetStateForNewMessage } from "./resetStateForNewMessage";
import { streamNormalInput } from "./streamNormalInput";
import { streamThunkWrapper } from "./streamThunkWrapper";
import { updateFileSymbolsFromFiles } from "./updateFileSymbols";
import { startStructuredAgentWorkflowThunk, handleStructuredAgentUserInputThunk } from "./structuredAgentWorkflow";

// 简单的函数来从JSONContent中提取文本
function extractTextFromEditorState(editorState: JSONContent): string {
  if (!editorState.content) return "";

  return editorState.content
    .map((node) => {
      if (node.type === "paragraph" && node.content) {
        return node.content
          .map((child) => {
            if (child.type === "text") {
              return child.text || "";
            }
            return "";
          })
          .join("");
      }
      return "";
    })
    .join("\n")
    .trim();
}

export const streamResponseThunk = createAsyncThunk<
  void,
  {
    editorState: JSONContent;
    modifiers: InputModifiers;
    index?: number;
    promptPreamble?: string;
    dynamicSystemMessage?: string;
  },
  ThunkApiType
>(
  "chat/streamResponse",
  async (
    { editorState, modifiers, index, promptPreamble, dynamicSystemMessage },
    { dispatch, extra, getState },
  ) => {
    await dispatch(
      streamThunkWrapper(async () => {
        const state = getState();
        const selectedChatModel = selectSelectedChatModel(state);
        const inputIndex = index ?? state.session.history.length; // Either given index or concat to end
        const mode = state.session.mode;

        if (!selectedChatModel) {
          throw new Error("No chat model selected");
        }

        // 如果是结构化agent模式且是新的用户输入
        if (mode === "structured-agent" && inputIndex === state.session.history.length) {
          const userInput = extractTextFromEditorState(editorState);
          if (userInput.trim()) {
            // 先检查是否是工作流程确认输入
            const handled = await dispatch(handleStructuredAgentUserInputThunk({ userInput }));
            const handledResult = handled.payload as boolean;

            if (handledResult) {
              return; // 已被工作流程处理，不需要继续
            }

            // 如果不是确认输入，且工作流程未激活，则启动新的工作流程
            if (!state.session.structuredAgentWorkflow.isActive) {
              await dispatch(startStructuredAgentWorkflowThunk({
                userInput,
                editorState
              }));
              return;
            }
          }
        }

        dispatch(
          submitEditorAndInitAtIndex({ index: inputIndex, editorState }),
        );
        resetStateForNewMessage();

        const result = await dispatch(
          gatherContext({
            editorState,
            modifiers,
            promptPreamble,
          }),
        );
        const {
          selectedContextItems,
          selectedCode,
          content,
          slashCommandWithInput,
        } = unwrapResult(result);

        // symbols for both context items AND selected codeblocks
        const filesForSymbols = [
          ...selectedContextItems
            .filter((item) => item.uri?.type === "file" && item?.uri?.value)
            .map((item) => item.uri!.value),
          ...selectedCode.map((rif) => rif.filepath),
        ];
        dispatch(updateFileSymbolsFromFiles(filesForSymbols));

        dispatch(
          updateHistoryItemAtIndex({
            index: inputIndex,
            updates: {
              message: {
                role: "user",
                content,
                id: uuidv4(),
              },
              contextItems: selectedContextItems,
            },
          }),
        );

        // Get updated history after the update
        const updatedHistory = getState().session.history;

        // Determine which rules apply to this message
        const userMsg = updatedHistory[inputIndex].message;
        const rules = getState().config.config.rules;

        // Calculate applicable rules once
        // We need to check the message type to match what getApplicableRules expects
        const applicableRules = getApplicableRules(
          userMsg.role === "user" || userMsg.role === "tool"
            ? (userMsg as UserChatMessage | ToolResultChatMessage)
            : undefined,
          rules,
          selectedContextItems,
        );

        // Store in history for UI display
        dispatch(
          setAppliedRulesAtIndex({
            index: inputIndex,
            appliedRules: applicableRules,
          }),
        );

        const messageMode = getState().session.mode;
        const baseChatOrAgentSystemMessage = getBaseSystemMessage(
          selectedChatModel,
          messageMode,
        );

        const messages = constructMessages(
          messageMode,
          [...updatedHistory],
          baseChatOrAgentSystemMessage,
          applicableRules,
          getState().config.config,
          dynamicSystemMessage,
        );

        posthog.capture("step run", {
          step_name: "User Input",
          params: {},
        });
        posthog.capture("userInput", {});

        if (slashCommandWithInput) {
          posthog.capture("step run", {
            step_name: slashCommandWithInput.command.name,
            params: {},
          });
        }

        unwrapResult(
          await dispatch(
            streamNormalInput({
              messages,
              legacySlashCommandData: slashCommandWithInput
                ? {
                    command: slashCommandWithInput.command,
                    contextItems: selectedContextItems,
                    historyIndex: inputIndex,
                    input: slashCommandWithInput.input,
                    selectedCode,
                  }
                : undefined,
            }),
          ),
        );
      }),
    );
  },
);
