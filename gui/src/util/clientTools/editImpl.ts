import { resolveRelativePathInDir } from "core/util/ideUtils";
import { ClientToolImpl } from "./callClientTool";

export const editToolImpl: ClientToolImpl = async (
  args,
  toolCallId,
  extras,
) => {
  if (!extras.streamId) {
    throw new Error("Invalid apply state");
  }

  // 参数判空逻辑
  if (!args.filepath) {
    throw new Error("filepath is required");
  }
  if (!args.changes) {
    throw new Error("changes is required");
  }
  if (args.startLine === undefined || args.startLine === null) {
    throw new Error("startLine is required");
  }
  if (args.endLine === undefined || args.endLine === null) {
    throw new Error("endLine is required");
  }

  const firstUriMatch = await resolveRelativePathInDir(
    args.filepath,
    extras.ideMessenger.ide,
  );
  if (!firstUriMatch) {
    throw new Error(`${args.filepath} does not exist`);
  }
  const apply = await extras.ideMessenger.request("applyToFile", {
    streamId: extras.streamId,
    text: args.changes,
    startLine: args.startLine,
    endLine: args.endLine,
    toolCallId,
    filepath: firstUriMatch,
  });
  if (apply.status === "error") {
    throw new Error(apply.error);
  }
  const state = extras.getState();
  const autoAccept = !!state.config.config.ui?.autoAcceptEditToolDiffs;
  if (autoAccept) {
    // 等待apply状态变为"done"后再执行acceptDiff
    await waitForApplyStateToComplete(extras, extras.streamId);

    const out = await extras.ideMessenger.request("acceptDiff", {
      streamId: extras.streamId,
      filepath: firstUriMatch,
    });
    if (out.status === "error") {
      throw new Error(out.error);
    }
    return {
      respondImmediately: true,
      output: undefined, // TODO - feed edit results back to model (also in parallel listeners)
    };
  }
  return {
    respondImmediately: false,
    output: undefined, // No immediate output.
  };
};

// 等待apply状态完成的辅助函数
async function waitForApplyStateToComplete(
  extras: any,
  streamId: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const maxWaitTime = 30000; // 最大等待30秒
    const checkInterval = 100; // 每100ms检查一次
    let elapsedTime = 0;

    const checkStatus = () => {
      const state = extras.getState();
      const applyState = state.session.codeBlockApplyStates.states.find(
        (s: any) => s.streamId === streamId,
      );

      if (applyState?.status === "done") {
        resolve();
        return;
      }

      if (applyState?.status === "closed") {
        // 如果状态已经是closed，说明apply已经完成
        resolve();
        return;
      }

      elapsedTime += checkInterval;
      if (elapsedTime >= maxWaitTime) {
        reject(new Error("Timeout waiting for apply state to complete"));
        return;
      }

      setTimeout(checkStatus, checkInterval);
    };

    // 开始检查
    setTimeout(checkStatus, checkInterval);
  });
}
