import { IndexingProgressUpdate } from "core";
import { useContext, useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { isJetBrains } from "../../../util";
import { useWebviewListener } from "../../../hooks/useWebviewListener";
import IndexingProgressBar from "./IndexingProgressBar";
import IndexingProgressIndicator from "./IndexingProgressIndicator";
import IndexingProgressTitleText from "./IndexingProgressTitleText";
import IndexingProgressSubtext from "./IndexingProgressSubtext";
import { usePostHog } from "posthog-js/react";
import ConfirmationDialog from "../../../components/dialogs/ConfirmationDialog";
import { setShowDialog, setDialogMessage } from "../../../redux/slices/uiSlice";
import IndexingProgressErrorText from "./IndexingProgressErrorText";

export function getProgressPercentage(
  progress: IndexingProgressUpdate["progress"],
) {
  return Math.min(100, Math.max(0, progress * 100));
}

function IndexingProgress() {
  const ideMessenger = useContext(IdeMessengerContext);
  const posthog = usePostHog();
  const dispatch = useDispatch();
  const [paused, setPaused] = useState<boolean | undefined>(undefined);
  const [update, setUpdate] = useState<IndexingProgressUpdate>({
    desc: "Loading indexing config",
    progress: 0.0,
    status: "loading",
  });

  // If sidebar is opened after extension initializes, retrieve saved states.
  let initialized = false;

  useWebviewListener("indexProgress", async (data) => {
    setUpdate(data);
  });

  useEffect(() => {
    if (!initialized) {
      // Triggers retrieval for possible non-default states set prior to IndexingProgressBar initialization
      ideMessenger.post("index/indexingProgressBarInitialized", undefined);
      initialized = true;
    }
  }, []);

  useEffect(() => {
    if (paused === undefined) return;
    ideMessenger.post("index/setPaused", paused);
  }, [paused]);

  function onClickRetry() {
    // 在IDEA中始终显示确认对话框，在其他环境中只有在需要清除索引时才显示
    if (update.shouldClearIndexes || isJetBrains()) {
      dispatch(setShowDialog(true));
      dispatch(
        setDialogMessage(
          <ConfirmationDialog
            title="重建代码库索引"
            confirmText="重建"
            text={
              update.shouldClearIndexes
                ? "您的索引可能已损坏。我们建议清除并重建索引，" +
                  "这对于大型代码库可能需要一些时间。\n\n" +
                  (isJetBrains()
                    ? "重建将清除现有索引数据并完全重新构建，确保索引的准确性和完整性。"
                    : "如需更快的重建而不清除数据，请按 'Shift + Command + P' 打开命令面板，" +
                      "然后输入 'Continue: Force Codebase Re-Indexing'")
                : "确认重新索引代码库？\n\n" +
                  "重建将清除现有索引数据并完全重新构建，确保索引的准确性和完整性。" +
                  "这对于大型代码库可能需要一些时间。"
            }
            onConfirm={() => {
              posthog.capture("rebuild_index_clicked");
              ideMessenger.post("index/forceReIndex", {
                shouldClearIndexes: true,
              });
            }}
          />,
        ),
      );
    } else {
      // 对于VSCode中不需要清除索引的情况，直接重新索引
      ideMessenger.post("index/forceReIndex", undefined);
    }
  }

  function showReindexConfirmation() {
    dispatch(setShowDialog(true));
    dispatch(
      setDialogMessage(
        <ConfirmationDialog
          title="重建代码库索引"
          confirmText="重建"
          text={
            "确认重新索引代码库？\n\n" +
            "重建将清除现有索引数据并完全重新构建，确保索引的准确性和完整性。" +
            "这对于大型代码库可能需要一些时间。"
          }
          onConfirm={() => {
            posthog.capture("rebuild_index_clicked");
            ideMessenger.post("index/forceReIndex", {
              shouldClearIndexes: true,
            });
          }}
        />,
      ),
    );
  }

  function onClick() {
    switch (update.status) {
      case "failed":
        onClickRetry();
        break;
      case "indexing":
      case "loading":
      case "paused":
        if (update.progress < 1 && update.progress >= 0) {
          setPaused((prev) => !prev);
        } else {
          // 在IDEA中显示确认框，在其他环境中直接重新索引
          if (isJetBrains()) {
            showReindexConfirmation();
          } else {
            ideMessenger.post("index/forceReIndex", undefined);
          }
        }
        break;
      case "disabled":
        ideMessenger.post("config/openProfile", {
          profileId: undefined,
        });
        break;
      case "done":
        // 在IDEA中显示确认框，在其他环境中直接重新索引
        if (isJetBrains()) {
          showReindexConfirmation();
        } else {
          ideMessenger.post("index/forceReIndex", undefined);
        }
        break;
      default:
        break;
    }
  }

  return (
    <div className="mt-4 flex flex-col">
      <div className="mb-0 flex justify-between text-sm">
        <IndexingProgressTitleText update={update} />
        {update.status !== "loading" && (
          <IndexingProgressIndicator update={update} />
        )}
      </div>

      <IndexingProgressBar update={update} />

      <IndexingProgressSubtext update={update} onClick={onClick} />

      {update.status === "failed" && (
        <div className="mt-4">
          <IndexingProgressErrorText update={update} />
        </div>
      )}
    </div>
  );
}

export default IndexingProgress;
