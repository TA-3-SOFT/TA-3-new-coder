import { ChevronDownIcon } from "@heroicons/react/24/outline";
import { inferResolvedUriFromRelativePath } from "core/util/ideUtils";
import { useContext, useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import {
  defaultBorderRadius,
  vscCommandCenterInactiveBorder,
  vscEditorBackground,
} from "../..";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { useIdeMessengerRequest } from "../../../hooks";
import { useWebviewListener } from "../../../hooks/useWebviewListener";
import { useAppSelector } from "../../../redux/hooks";
import { selectCurrentToolCallApplyState } from "../../../redux/selectors/selectCurrentToolCall";
import { selectApplyStateByStreamId } from "../../../redux/slices/sessionSlice";
import { getFontSize } from "../../../util";
import Spinner from "../../gui/Spinner";
import { isTerminalCodeBlock } from "../utils";
import { ApplyActions } from "./ApplyActions";
import { CopyButton } from "./CopyButton";
import { CreateFileButton } from "./CreateFileButton";
import { FileInfo } from "./FileInfo";
import { InsertButton } from "./InsertButton";
import { RunInTerminalButton } from "./RunInTerminalButton";

/**
 * 使用大模型推理代码块应该应用到文件的哪些行
 */
async function inferCodeBlockPosition(
  fileContent: string,
  codeBlockContent: string,
  language: string | null,
  ideMessenger: any,
): Promise<{ inferredStartLine: number; inferredEndLine: number }> {
  const codeLines = codeBlockContent.split("\n").filter((line) => line.trim());

  if (codeLines.length === 0) {
    return { inferredStartLine: 0, inferredEndLine: 0 };
  }

  const llmResult = await inferPositionWithLLM(
    fileContent,
    codeBlockContent,
    language,
    ideMessenger,
  );
  if (llmResult) {
    return llmResult;
  }

  // 如果大模型推理失败，返回默认值
  const fileLines = fileContent.split("\n");
  return {
    inferredStartLine: 0,
    inferredEndLine: fileLines.length - 1,
  };
}

/**
 * 使用大模型推理代码块的最佳应用位置
 */
async function inferPositionWithLLM(
  fileContent: string,
  codeBlockContent: string,
  language: string | null,
  ideMessenger: any,
): Promise<{ inferredStartLine: number; inferredEndLine: number } | null> {
  // 构建给大模型的提示
  const prompt = buildLLMPrompt(fileContent, codeBlockContent, language);
  try {
    // 创建消息数组
    const messages = [
      {
        role: "user" as const,
        content: prompt,
      },
    ];

    // 调用大模型
    const abortController = new AbortController();
    const gen = ideMessenger.llmStreamChat(
      {
        messages,
        completionOptions: {
          temperature: 0.1, // 使用较低的温度以获得更确定的结果
          maxTokens: 200,
        },
        title: undefined, // 使用默认的聊天模型
      },
      abortController.signal,
    );

    // 收集完整的响应
    let fullResponse = "";
    let next = await gen.next();
    while (!next.done) {
      if (next.value && next.value.length > 0) {
        for (const chunk of next.value) {
          fullResponse += chunk.content || "";
        }
      }
      next = await gen.next();
    }

    // 解析大模型的响应
    return parseLLMResponse(fullResponse);
  } catch (error) {
    console.error("Error calling LLM for position inference:", error);
    return null;
  }
}

/**
 * 构建给大模型的提示
 */
function buildLLMPrompt(
  fileContent: string,
  codeBlockContent: string,
  language: string | null,
): string {
  const fileLines = fileContent.split("\n");
  const totalLines = fileLines.length;

  return `分析代码块应该应用到原文件的区域，给出区域的开始行和结束行。

原文件内容（${totalLines}行）：
\`\`\`${language || ""}
${fileContent}
\`\`\`

代码块：
\`\`\`${language || ""}
${codeBlockContent}
\`\`\`

返回JSON纯文本，不要有额外的解释或文本格式，示例如下：{"startLine": 10, "endLine": 20}`;
}

/**
 * 解析大模型的响应
 */
function parseLLMResponse(
  response: string,
): { inferredStartLine: number; inferredEndLine: number } | null {
  try {
    // 尝试从响应中提取JSON
    const jsonMatch = response.match(/\{[^}]*"startLine"[^}]*\}/);
    if (!jsonMatch) {
      return null;
    }
    const parsed = JSON.parse(jsonMatch[0]);
    const startLine = parseInt(parsed.startLine);
    const endLine = parseInt(parsed.endLine);
    // 验证行号的有效性
    if (isNaN(startLine) || isNaN(endLine)) {
      return null;
    }
    return {
      inferredStartLine: startLine,
      inferredEndLine: endLine,
    };
  } catch (error) {
    console.error("Error parsing LLM response:", error);
    return null;
  }
}

const TopDiv = styled.div`
  display: flex;
  flex-direction: column;
  outline: 1px solid ${vscCommandCenterInactiveBorder};
  outline-offset: -0.5px;
  border-radius: ${defaultBorderRadius};
  margin-bottom: 8px !important;
  margin-top: 8px !important;
  background-color: ${vscEditorBackground};
  min-width: 0;
`;

const ToolbarDiv = styled.div<{ isExpanded: boolean }>`
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: ${getFontSize() - 2}px;
  padding: 4px 6px;
  margin: 0;
  border-bottom: ${({ isExpanded }) =>
    isExpanded ? `1px solid ${vscCommandCenterInactiveBorder}` : "inherit"};
`;

export interface StepContainerPreToolbarProps {
  codeBlockContent: string;
  language: string | null;
  relativeFilepath?: string;
  itemIndex?: number;
  codeBlockIndex: number; // To track which codeblock we are applying
  isLastCodeblock: boolean;
  codeBlockStreamId: string;
  range?: string;
  children: any;
  expanded?: boolean;
  disableManualApply?: boolean;
}

export function StepContainerPreToolbar({
  codeBlockContent,
  language,
  relativeFilepath,
  itemIndex,
  codeBlockIndex,
  isLastCodeblock,
  codeBlockStreamId,
  range,
  children,
  expanded,
  disableManualApply,
}: StepContainerPreToolbarProps) {
  const ideMessenger = useContext(IdeMessengerContext);
  const history = useAppSelector((state) => state.session.history);
  const [isExpanded, setIsExpanded] = useState(expanded ?? true);
  const [isInferringPosition, setIsInferringPosition] = useState(false);

  const [relativeFilepathUri, setRelativeFilepathUri] = useState<string | null>(
    null,
  );

  const fileExistsInput = useMemo(
    () => (relativeFilepathUri ? { filepath: relativeFilepathUri } : null),
    [relativeFilepathUri],
  );

  const {
    result: fileExists,
    refresh: refreshFileExists,
    isLoading: isLoadingFileExists,
  } = useIdeMessengerRequest("fileExists", fileExistsInput);

  const nextCodeBlockIndex = useAppSelector(
    (state) => state.session.codeBlockApplyStates.curIndex,
  );

  const applyState = useAppSelector((state) =>
    selectApplyStateByStreamId(state, codeBlockStreamId),
  );
  const currentToolCallApplyState = useAppSelector(
    selectCurrentToolCallApplyState,
  );

  /**
   * In the case where `relativeFilepath` is defined, this will just be `relativeFilepathUri`.
   * However, if no `relativeFilepath` is defined, then this will
   * be the URI of the currently open file at the time the user clicks "Apply".
   */
  const [appliedFileUri, setAppliedFileUri] = useState<string | undefined>(
    undefined,
  );

  const isNextCodeBlock = nextCodeBlockIndex === codeBlockIndex;
  const hasFileExtension =
    relativeFilepath && /\.[0-9a-z]+$/i.test(relativeFilepath);

  const isStreaming = useAppSelector((store) => store.session.isStreaming);

  const isLastItem = useMemo(() => {
    return itemIndex === history.length - 1;
  }, [history.length, itemIndex]);

  const isGeneratingCodeBlock = isLastItem && isLastCodeblock && isStreaming;

  // If we are creating a file, we already render that in the button
  // so we don't want to dispaly it twice here
  const displayFilepath = relativeFilepath ?? appliedFileUri;

  // TODO: This logic should be moved to a thunk
  // Handle apply keyboard shortcut
  useWebviewListener(
    "applyCodeFromChat",
    async () => onClickApply(),
    [isNextCodeBlock, codeBlockContent],
    !isNextCodeBlock,
  );

  useEffect(() => {
    const getRelativeFilepathUri = async () => {
      if (relativeFilepath) {
        const resolvedUri = await inferResolvedUriFromRelativePath(
          relativeFilepath,
          ideMessenger.ide,
        );
        setRelativeFilepathUri(resolvedUri);
      }
    };
    getRelativeFilepathUri();
  }, [relativeFilepath, ideMessenger.ide]);

  async function getFileUriToApplyTo() {
    // If we've already resolved a file URI (from clicking apply), use that
    if (appliedFileUri) {
      return appliedFileUri;
    }

    // If we have the `relativeFilepathUri`, use that
    if (relativeFilepathUri) {
      return relativeFilepathUri;
    }

    // If no filepath was provided, get the current file
    const currentFile = await ideMessenger.ide.getCurrentFile();
    if (currentFile) {
      return currentFile.path;
    }

    return undefined;
  }

  async function onClickApply() {
    const fileUri = await getFileUriToApplyTo();
    if (!fileUri) {
      ideMessenger.ide.showToast(
        "error",
        "Could not resolve filepath to apply changes",
      );
      return;
    }

    // Get current file content to analyze where to apply changes
    let startLine = 0;
    let endLine = 0;

    try {
      const fileContent = await ideMessenger.ide.readFile(fileUri);
      if (fileContent && fileContent.trim()) {
        setIsInferringPosition(true);
        try {
          const { inferredStartLine, inferredEndLine } =
            await inferCodeBlockPosition(
              fileContent,
              codeBlockContent,
              language,
              ideMessenger,
            );
          startLine = inferredStartLine;
          endLine = inferredEndLine;
        } finally {
          setIsInferringPosition(false);
        }
      }
    } catch (error) {
      console.warn(
        "Failed to read file content for position inference:",
        error,
      );
      setIsInferringPosition(false);
    }

    // applyToFile will create the file if it doesn't exist
    ideMessenger.post("applyToFile", {
      streamId: codeBlockStreamId,
      filepath: fileUri,
      text: codeBlockContent,
      startLine,
      endLine,
    });

    setAppliedFileUri(fileUri);
    refreshFileExists();
  }

  function onClickInsertAtCursor() {
    ideMessenger.post("insertAtCursor", { text: codeBlockContent });
  }

  async function handleDiffAction(action: "accept" | "reject") {
    const filepath = await getFileUriToApplyTo();
    if (!filepath) {
      ideMessenger.ide.showToast(
        "error",
        `Could not resolve filepath to ${action} changes`,
      );
      return;
    }

    ideMessenger.post(`${action}Diff`, {
      filepath,
      streamId: codeBlockStreamId,
    });

    setAppliedFileUri(undefined);
  }

  async function onClickFilename() {
    if (appliedFileUri) {
      ideMessenger.post("showFile", {
        filepath: appliedFileUri,
      });
    }

    if (relativeFilepath) {
      const filepath = await inferResolvedUriFromRelativePath(
        relativeFilepath,
        ideMessenger.ide,
      );

      ideMessenger.post("showFile", {
        filepath,
      });
    }
  }

  const renderActionButtons = () => {
    const isPendingToolCall =
      currentToolCallApplyState &&
      currentToolCallApplyState.streamId === applyState?.streamId &&
      currentToolCallApplyState.status === "not-started";

    if (isGeneratingCodeBlock || isPendingToolCall) {
      const numLines = codeBlockContent.split("\n").length;
      const plural = numLines === 1 ? "" : "s";
      if (isGeneratingCodeBlock) {
        return (
          <span className="text-lightgray inline-flex items-center gap-2 text-right">
            {!isExpanded ? `${numLines} line${plural}` : "Generating"}{" "}
            <div>
              <Spinner />
            </div>
          </span>
        );
      } else {
        return (
          <span className="text-lightgray inline-flex items-center gap-2 text-right">
            {`${numLines} line${plural} pending`}
          </span>
        );
      }
    }

    if (isTerminalCodeBlock(language, codeBlockContent)) {
      return <RunInTerminalButton command={codeBlockContent} />;
    }

    if (isLoadingFileExists) {
      return null;
    }

    if (fileExists || !relativeFilepath) {
      return (
        <ApplyActions
          disableManualApply={disableManualApply}
          applyState={applyState}
          onClickApply={onClickApply}
          onClickAccept={() => handleDiffAction("accept")}
          onClickReject={() => handleDiffAction("reject")}
          isInferringPosition={isInferringPosition}
        />
      );
    }

    return <CreateFileButton onClick={onClickApply} />;
  };

  // We wait until there is an extension in the filepath to avoid rendering
  // an incomplete filepath
  if (relativeFilepath && !hasFileExtension) {
    return children;
  }

  return (
    <TopDiv>
      <ToolbarDiv isExpanded={isExpanded} className="find-widget-skip gap-3">
        <div className="flex max-w-72 flex-row items-center">
          <ChevronDownIcon
            onClick={() => setIsExpanded(!isExpanded)}
            className={`text-lightgray h-3.5 w-3.5 flex-shrink-0 cursor-pointer hover:brightness-125 ${
              isExpanded ? "rotate-0" : "-rotate-90"
            }`}
          />
          {displayFilepath ? (
            <FileInfo
              filepath={displayFilepath}
              range={range}
              onClick={fileExists ? onClickFilename : undefined}
            />
          ) : (
            <span className="text-lightgray ml-2 select-none capitalize">
              {language}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          {!isGeneratingCodeBlock && (
            <div className="xs:flex hidden items-center gap-2.5">
              <InsertButton onInsert={onClickInsertAtCursor} />
              <CopyButton text={codeBlockContent} />
            </div>
          )}

          {renderActionButtons()}
        </div>
      </ToolbarDiv>

      {isExpanded && (
        <div className="overflow-hidden overflow-y-auto">{children}</div>
      )}
    </TopDiv>
  );
}
