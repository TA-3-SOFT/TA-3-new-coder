import {
  ArrowUturnLeftIcon,
  CheckIcon,
  DocumentIcon,
  DocumentPlusIcon,
  EyeIcon,
  ListBulletIcon,
  PencilIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { useContext, useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import { v4 as uuidv4 } from "uuid";
import {
  defaultBorderRadius,
  lightGray,
  vscBackground,
  vscForeground,
  vscInputBorder,
  vscListActiveBackground,
} from ".";
import { IdeMessengerContext } from "../context/IdeMessenger";
import { ToolTip } from "./gui/Tooltip";
import { useAppDispatch, useAppSelector } from "../redux/hooks";
import { resolveRelativePathInDir } from "core/util/ideUtils";
import { ModifiedFile } from "core";
import {
  clearPendingConfirmFilesList,
  setAcceptHistoryIndex,
  setPendingConfirmFilesList,
  setShowModifiedFilesList,
} from "../redux/slices/sessionSlice";
import { saveCurrentSession } from "../redux/thunks/session";

const Container = styled.div`
  background-color: ${vscBackground};
  border: 1px solid ${vscInputBorder};
  border-radius: ${defaultBorderRadius};
  margin: 8px 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid ${vscInputBorder};
  font-size: 12px;
  font-weight: 600;
  color: ${vscForeground};
  background-color: rgba(255, 255, 255, 0.02);
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

const FileList = styled.div`
  max-height: 160px;
  overflow-y: auto;
`;

const FileItem = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  transition: background-color 0.2s;

  &:hover {
    background-color: ${vscListActiveBackground};
  }

  &:last-child {
    border-bottom: none;
  }
`;

const FileInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  cursor: pointer;
`;

const FileIcon = styled.div`
  display: flex;
  align-items: center;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
`;

const FileName = styled.span`
  font-size: 12px;
  color: ${vscForeground};
  font-weight: 500;
`;

const FilePath = styled.div`
  font-size: 10px;
  color: ${lightGray};
  margin-left: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl;
  text-align: left;
  max-width: 250px;
  display: inline-block;
`;

const FileActions = styled.div`
  display: flex;
  gap: 2px;
  align-items: center;
`;

const ActionButton = styled.button`
  background: none;
  border: none;
  color: ${lightGray};
  cursor: pointer;
  padding: 4px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;

  &:hover {
    background-color: ${vscListActiveBackground};
    color: ${vscForeground};
  }
`;

const BottomActions = styled.div`
  display: flex;
  border-top: 1px solid ${vscInputBorder};
`;

const BottomButton = styled.button<{ variant: "discard" | "keep" }>`
  flex: 1;
  padding: 4px 4px;
  border: none;
  background-color: ${(props) =>
    props.variant === "discard" ? "#F0F0F3" : "#d4edda"};
  color: ${(props) => (props.variant === "discard" ? "#6c757d" : "#155724")};
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: all 0.2s;

  &:hover {
    background-color: ${(props) =>
      props.variant === "discard" ? "#e9ecef" : "#c3e6cb"};
  }

  &:first-child {
    border-bottom-left-radius: ${defaultBorderRadius};
  }

  &:last-child {
    border-bottom-right-radius: ${defaultBorderRadius};
  }
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  color: ${vscForeground};
  cursor: pointer;
  padding: 3px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s;

  &:hover {
    background-color: ${vscListActiveBackground};
  }
`;

// interface ModifiedFilesListProps {
//   onClose?: () => void;
//   onAcceptAll?: () => void;
//   onPendingConfirmFilesList?: (files: ModifiedFile[]) => void;
// }

export function ModifiedFilesList() {
  const ideMessenger = useContext(IdeMessengerContext);
  const history = useAppSelector((state) => state.session.history);
  const acceptHistoryIndex = useAppSelector(
    (state) => state.session.fullyAutomaticEditModeMetadata.acceptHistoryIndex,
  );
  const pendingConfirmFilesList = useAppSelector(
    (state) =>
      state.session.fullyAutomaticEditModeMetadata.pendingConfirmFilesList,
  );
  const dispatch = useAppDispatch();

  // 从会话历史中提取修改的文件
  // const modifiedFiles = useMemo(() => {
  //   const files: ModifiedFile[] = [];
  //   const seenFiles = new Map<string, ModifiedFile>();
  //
  //   history.slice(acceptHistoryIndex + 1, -1).forEach((item) => {
  //     if (
  //       item.message.role === "assistant" &&
  //       item.message.toolCalls &&
  //       item.toolCallState
  //     ) {
  //       item.message.toolCalls.forEach((toolCall) => {
  //         const args = item.toolCallState?.parsedArgs;
  //         if (!args) return;
  //
  //         let filepath: string | undefined;
  //         let type: "create" | "edit" | undefined;
  //
  //         switch (toolCall.function?.name) {
  //           case "builtin_create_new_file":
  //             filepath = args.filepath;
  //             type = "create";
  //             break;
  //           case "builtin_edit_existing_file":
  //             filepath = args.filepath;
  //             type = "edit";
  //             break;
  //         }
  //
  //         if (filepath && type) {
  //           // 如果文件已经存在，更新类型（编辑优先于创建）
  //           const existingFile = seenFiles.get(filepath);
  //           if (
  //             !existingFile ||
  //             (existingFile.type === "create" && type === "edit")
  //           ) {
  //             seenFiles.set(filepath, {
  //               filepath,
  //               type,
  //               toolCallId: toolCall.id,
  //             });
  //           }
  //         }
  //       });
  //     }
  //   });
  //   return Array.from(seenFiles.values());
  // }, [history]);

  useEffect(() => {
    const seenFiles = new Map<string, ModifiedFile>();

    history.slice(acceptHistoryIndex + 1, -1).forEach((item) => {
      if (
        item.message.role === "assistant" &&
        item.message.toolCalls &&
        item.toolCallState
      ) {
        item.message.toolCalls.forEach((toolCall) => {
          const args = item.toolCallState?.parsedArgs;
          if (!args) return;

          let filepath: string | undefined;
          let type: "create" | "edit" | undefined;

          switch (toolCall.function?.name) {
            case "builtin_create_new_file":
              filepath = args.filepath;
              type = "create";
              break;
            case "builtin_edit_existing_file":
              filepath = args.filepath;
              type = "edit";
              break;
          }

          if (filepath && type) {
            // 如果文件已经存在，更新类型（编辑优先于创建）
            const existingFile = seenFiles.get(filepath);
            if (
              !existingFile ||
              (existingFile.type === "create" && type === "edit")
            ) {
              seenFiles.set(filepath, {
                filepath,
                type,
                toolCallId: toolCall.id,
              });
            }
          }
        });
      }
    });
    // onPendingConfirmFilesList?.(Array.from(seenFiles.values()));
    dispatch(setPendingConfirmFilesList(Array.from(seenFiles.values())));
  }, [history]);

  const getAbsolutePath = async (relativePath: string): Promise<string> => {
    const firstUriMatch = await resolveRelativePathInDir(
      relativePath,
      ideMessenger.ide,
    );
    if (!firstUriMatch) {
      throw new Error(`${relativePath} does not exist`);
    }
    return firstUriMatch;
  };

  const handleFileClick = async (filepath: string) => {
    try {
      const fileUri = await getAbsolutePath(filepath);
      console.log("Opening file with URI:", fileUri);
      await ideMessenger.post("openFile", { path: fileUri });
    } catch (error) {
      console.error("Failed to open file:", error);
    }
  };

  const handleShowDiff = async (filepath: string) => {
    try {
      const fileUri = await getAbsolutePath(filepath);
      console.log("Opening file diff with URI:", fileUri);

      let message;
      if (acceptHistoryIndex > 0) {
        message = history[acceptHistoryIndex + 1].message;
      } else {
        message = history[0].message;
      }
      if (message.role === "user" && message.timestamp) {
        // 调用 showAgentDiff 来显示文件差异
        try {
          await ideMessenger.post("showAgentDiff", {
            filepath: fileUri,
            timestamp: message.timestamp,
          });
          console.log("Showing agent diff for file:", fileUri);
        } catch (diffError) {
          console.log("Agent diff view not available, opening file normally");
          // 如果 showAgentDiff 失败，则回退到普通的文件打开
          await ideMessenger.post("openFile", { path: fileUri });
        }
      }
    } catch (error) {
      console.error("Failed to show agent diff:", error);
    }
  };

  const getFileName = (filepath: string) => {
    return filepath.split("/").pop() || filepath;
  };

  const getFileDirectory = (filepath: string) => {
    const parts = filepath.split("/");
    return parts.slice(0, -1).join("/");
  };

  const handleRevertFile = async (filepath: string) => {
    console.log("Agent回退修改:", filepath);
    try {
      const absolutePath = await getAbsolutePath(filepath);
      let message;
      if (acceptHistoryIndex > 0) {
        message = history[acceptHistoryIndex + 1].message;
      } else {
        message = history[0].message;
      }
      if (message.role === "user" && message.timestamp) {
        try {
          // 调用 revertFile 来回滚文件
          await ideMessenger.post("revertFile", {
            filepath: absolutePath,
            timestamp: message.timestamp,
          });
          // 记录操作点
          dispatch(setAcceptHistoryIndex(history.length - 1));
          // 移除已经处理的文件
          const updatedFilesList = pendingConfirmFilesList.filter(
            (file) => file.filepath !== filepath,
          );
          dispatch(setPendingConfirmFilesList(updatedFilesList));
          // 持久化会话状态
          await dispatch(
            saveCurrentSession({
              openNewSession: false,
              generateTitle: false,
            }),
          );
          console.log("revert for file:", absolutePath);
        } catch (diffError) {
          console.log("Agent 回退文件失败, 打开文件");
          // 如果 showAgentDiff 失败，则回退到普通的文件打开
          await ideMessenger.post("openFile", { path: absolutePath });
        }
      }
    } catch (error) {
      console.error("Agent 回退文件失败:", error);
    }
  };

  const handleDiscardAll = async () => {
    console.log("Agent回退全部修改");
    try {
      let message;
      if (acceptHistoryIndex > 0) {
        message = history[acceptHistoryIndex + 1].message;
      } else {
        message = history[0].message;
      }
      if (message.role === "user" && message.timestamp) {
        // 循环调用revertFile接口来回滚所有文件
        for (const f of pendingConfirmFilesList) {
          const absolutePath = await getAbsolutePath(f.filepath);
          try {
            // 调用 revertFile 来回滚文件
            await ideMessenger.post("revertFile", {
              filepath: absolutePath,
              timestamp: message.timestamp,
            });
          } catch (diffError) {
            console.log("Agent 回退全部修改失败");
          }
        }
        dispatch(setAcceptHistoryIndex(history.length - 1));
        dispatch(clearPendingConfirmFilesList());
        await dispatch(
          saveCurrentSession({
            openNewSession: false,
            generateTitle: false,
          }),
        );
      }
    } catch (error) {
      console.error("Agent 回退全部修改失败:", error);
    }
  };

  const handleKeepAll = async () => {
    console.log("Agent接受全部修改");
    // 实现接受所有修改的逻辑
    await ideMessenger.post("saveAllFiles", {});
    dispatch(setAcceptHistoryIndex(history.length - 1));
    dispatch(clearPendingConfirmFilesList());
    await dispatch(
      saveCurrentSession({
        openNewSession: false,
        generateTitle: false,
      }),
    );
  };

  const getFileIcon = (type: "create" | "edit") => {
    switch (type) {
      case "create":
        return <DocumentPlusIcon className="h-3.5 w-3.5 text-green-500" />;
      case "edit":
        return <PencilIcon className="h-3.5 w-3.5 text-blue-500" />;
      default:
        return <DocumentIcon className="h-3.5 w-3.5" />;
    }
  };

  if (pendingConfirmFilesList.length === 0) {
    return null;
  }

  return (
    <Container>
      <Header>
        <HeaderLeft>
          <ListBulletIcon className="h-3.5 w-3.5" />
          <span>{pendingConfirmFilesList.length} 个文件已修改</span>
        </HeaderLeft>
        {/*        {onClose && (
          <CloseButton onClick={onClose}>
            <XMarkIcon className="h-3.5 w-3.5" />
          </CloseButton>
        )}*/}
      </Header>
      <FileList>
        {pendingConfirmFilesList.map((file, index) => (
          <FileItem key={`${file.filepath}-${index}`}>
            <FileInfo onClick={() => handleShowDiff(file.filepath)}>
              <FileIcon>{getFileIcon(file.type)}</FileIcon>
              <div>
                <FileName>{getFileName(file.filepath)}</FileName>
                <FilePath>{getFileDirectory(file.filepath)}</FilePath>
              </div>
            </FileInfo>
            <FileActions>
              {(() => {
                const openFileTooltipId = `open-file-${uuidv4()}`;
                return (
                  <>
                    <ActionButton
                      onClick={(e) => {
                        e.stopPropagation();
                        handleFileClick(file.filepath);
                      }}
                      data-tooltip-id={openFileTooltipId}
                    >
                      <EyeIcon className="h-3.5 w-3.5" />
                    </ActionButton>
                    <ToolTip id={openFileTooltipId} place="top">
                      <span className="text-xs">打开文件</span>
                    </ToolTip>
                  </>
                );
              })()}
              {(() => {
                const revertFileTooltipId = `revert-file-${uuidv4()}`;
                return (
                  <>
                    <ActionButton
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRevertFile(file.filepath);
                      }}
                      data-tooltip-id={revertFileTooltipId}
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </ActionButton>
                    <ToolTip id={revertFileTooltipId} place="top">
                      <span className="text-xs">回退修改</span>
                    </ToolTip>
                  </>
                );
              })()}
            </FileActions>
          </FileItem>
        ))}
      </FileList>
      <BottomActions>
        <BottomButton variant="discard" onClick={handleDiscardAll}>
          <ArrowUturnLeftIcon className="h-3.5 w-3.5" />
          回退全部
        </BottomButton>
        <BottomButton variant="keep" onClick={handleKeepAll}>
          <CheckIcon className="h-3.5 w-3.5" />
          接受全部
        </BottomButton>
      </BottomActions>
    </Container>
  );
}
