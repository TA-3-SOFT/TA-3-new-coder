import { ChatHistoryItem } from "core";
import { renderChatMessage, stripImages } from "core/util/messageContent";
import { useContext, useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import styled from "styled-components";
import { vscBackground } from "..";
import { useAppSelector } from "../../redux/hooks";
import { selectUIConfig } from "../../redux/slices/configSlice";
import { deleteMessage, editMessage } from "../../redux/slices/sessionSlice";
import { getFontSize } from "../../util";
import { varWithFallback } from "../../styles/theme";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import StyledMarkdownPreview from "../StyledMarkdownPreview";
import Reasoning from "./Reasoning";
import ResponseActions from "./ResponseActions";
import ThinkingIndicator from "./ThinkingIndicator";

interface StepContainerProps {
  item: ChatHistoryItem;
  index: number;
  isLast: boolean;
}

const ContentDiv = styled.div<{ fontSize?: number }>`
  padding: 4px;
  padding-left: 6px;
  padding-right: 6px;

  background-color: ${vscBackground};
  font-size: ${getFontSize()}px;
  overflow: hidden;
`;

const EditContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 8px;
  border-radius: 8px;
  background: ${varWithFallback("editor-background")};
  border: 1px solid ${varWithFallback("border")};
  //box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
`;

const EditTextarea = styled.textarea`
  min-height: 300px;
  height: 500px;
  padding: 12px;
  border: 1px solid ${varWithFallback("border-focus")};
  border-radius: 6px;
  background: ${varWithFallback("editor-background")};
  color: ${varWithFallback("editor-foreground")};
  font-size: ${getFontSize()}px;
  font-family: "JetBrains Mono", "Consolas", "Monaco", monospace;
  line-height: 1.5;
  resize: none;
  outline: none;
  transition: all 0.2s ease;

  &:focus {
    border-color: ${varWithFallback("border-focus")};
    box-shadow: 0 0 0 2px ${varWithFallback("border-focus")}20;
  }

  &::placeholder {
    color: ${varWithFallback("description")};
  }
`;

const ButtonContainer = styled.div`
  display: flex;
  gap: 8px;
  justify-content: flex-end;
`;

const EditButton = styled.button<{ variant: "primary" | "secondary" }>`
  padding: 4px 8px;
  border: none;
  border-radius: 4px;
  font-size: ${getFontSize() - 2}px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 48px;
  justify-content: center;

  ${(props) =>
    props.variant === "primary"
      ? `
    background: ${varWithFallback("primary-background")};
    color: ${varWithFallback("primary-foreground")};

    &:hover {
      background: ${varWithFallback("primary-hover")};
      transform: translateY(-1px);
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
    }
  `
      : `
    background: ${varWithFallback("secondary-background")};
    color: ${varWithFallback("secondary-foreground")};
    border: 1px solid ${varWithFallback("border")};

    &:hover {
      background: ${varWithFallback("secondary-hover")};
      transform: translateY(-1px);
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
  `}

  &:active {
    transform: translateY(0);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
  }
`;

export default function StepContainer(props: StepContainerProps) {
  const dispatch = useDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const [isTruncated, setIsTruncated] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState("");
  const isStreaming = useAppSelector((state) => state.session.isStreaming);
  const history = useAppSelector((state) => state.session.history);
  const historyItemAfterThis = useAppSelector(
    (state) => state.session.history[props.index + 1],
  );
  const uiConfig = useAppSelector(selectUIConfig);
  const mode = useAppSelector((state) => state.session.mode);
  const structuredAgentWorkflow = useAppSelector(
    (state) => state.session.structuredAgentWorkflow,
  );

  const hideActionSpace =
    historyItemAfterThis?.message.role === "assistant" ||
    historyItemAfterThis?.message.role === "thinking";
  const hideActions = hideActionSpace || (isStreaming && props.isLast);

  useEffect(() => {
    if (!isStreaming) {
      const content = renderChatMessage(props.item.message).trim();
      const endingPunctuation = [".", "?", "!", "```", ":"];

      // If not ending in punctuation or emoji, we assume the response got truncated
      if (
        content.trim() !== "" &&
        !(
          endingPunctuation.some((p) => content.endsWith(p)) ||
          /\p{Emoji}/u.test(content.slice(-2))
        )
      ) {
        setIsTruncated(true);
      } else {
        setIsTruncated(false);
      }
    }
  }, [props.item.message.content, isStreaming]);

  function onDelete() {
    dispatch(deleteMessage(props.index));
  }

  function onContinueGeneration() {
    window.postMessage(
      {
        messageType: "userInput",
        data: {
          input: "continue",
        },
      },
      "*",
    );
  }
  function findLastUserTimestamp(): number | undefined {
    // 从当前索引位置向前查找最近的一个role为user的timestamp
    for (let i = props.index - 1; i >= 0; i--) {
      const historyItem = history[i];
      if (
        historyItem?.message?.role === "user" &&
        historyItem.message.timestamp
      ) {
        return historyItem.message.timestamp;
      }
    }
    return undefined;
  }

  async function onRollBack() {
    const lastUserTimestamp = findLastUserTimestamp();
    if (lastUserTimestamp) {
      try {
        // 使用 ideMessenger.request 发送回滚请求
        await ideMessenger.request("rollbackToCheckpoint", {
          checkpointId: lastUserTimestamp.toString(),
        });
      } catch (error) {
        console.error("Rollback failed:", error);
      }
    } else {
      console.warn("No user timestamp found for rollback");
    }
  }

  function onEdit() {
    setEditedContent(renderChatMessage(props.item.message));
    setIsEditing(true);
  }

  function onSaveEdit() {
    dispatch(editMessage({ index: props.index, content: editedContent }));
    setIsEditing(false);
  }

  function onCancelEdit() {
    setIsEditing(false);
    setEditedContent("");
  }

  return (
    <div>
      <ContentDiv>
        {isEditing ? (
          <EditContainer>
            <EditTextarea
              value={editedContent}
              onChange={(e) => setEditedContent(e.target.value)}
              placeholder="编辑消息内容..."
              autoFocus
            />
            <ButtonContainer>
              <EditButton variant="secondary" onClick={onCancelEdit}>
                取消
              </EditButton>
              <EditButton variant="primary" onClick={onSaveEdit}>
                保存
              </EditButton>
            </ButtonContainer>
          </EditContainer>
        ) : uiConfig?.displayRawMarkdown ? (
          <pre
            className="max-w-full overflow-x-auto whitespace-pre-wrap break-words p-4"
            style={{ fontSize: getFontSize() - 2 }}
          >
            {renderChatMessage(props.item.message)}
          </pre>
        ) : (
          <>
            <Reasoning {...props} />

            <StyledMarkdownPreview
              isRenderingInStepContainer
              source={stripImages(props.item.message.content)}
              itemIndex={props.index}
            />
            {!hideActions &&
              mode === "structured-agent" &&
              structuredAgentWorkflow.isActive &&
              props.isLast && (
                <div
                  style={{
                    fontSize: "12px",
                    padding: "5px 8px",
                  }}
                >
                  <br />
                  [用户操作]：✅ 步骤完成，等待您的确认
                  <br />
                  执行下一步：点击下方“确认”按钮进入下一步，或在输入框中输入："确认"
                  <br />
                  调整回答内容：点击下方“编辑”按钮进入修改，或在输入框中输入具体的调整建议
                </div>
              )}
          </>
        )}
        {props.isLast && <ThinkingIndicator historyItem={props.item} />}
      </ContentDiv>
      {/* We want to occupy space in the DOM regardless of whether the actions are visible to avoid jank on stream complete */}
      {!hideActionSpace && (
        <div className={`mt-2 h-7 transition-opacity duration-300 ease-in-out`}>
          {!hideActions && (
            <ResponseActions
              isTruncated={isTruncated}
              onDelete={onDelete}
              onContinueGeneration={onContinueGeneration}
              onEdit={
                props.item.message.role === "assistant" &&
                mode === "structured-agent"
                  ? onEdit
                  : undefined
              }
              onRollback={onRollBack}
              index={props.index}
              item={props.item}
              isLast={props.isLast}
            />
          )}
        </div>
      )}
    </div>
  );
}
