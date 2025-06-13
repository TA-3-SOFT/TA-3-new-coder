import { IndexingProgressUpdate } from "core";

export interface IndexingProgressSubtextProps {
  update: IndexingProgressUpdate;
  onClick: () => void;
}

const STATUS_TO_SUBTITLE_TEXT: Record<
  IndexingProgressUpdate["status"],
  string | undefined
> = {
  done: "点击重新索引",
  loading: "",
  indexing: "点击暂停",
  paused: "点击继续",
  failed: "点击重试",
  disabled: "点击打开设置",
  cancelled: "点击重新启动",
};

function IndexingProgressSubtext({
  update,
  onClick,
}: IndexingProgressSubtextProps) {
  const showIndexingDesc = update.status === "indexing";

  return (
    <div className="flex justify-between">
      <span
        className={`text-lightgray inline-block cursor-pointer text-xs underline`}
        onClick={onClick}
      >
        {STATUS_TO_SUBTITLE_TEXT[update.status]}
      </span>

      <div className={`${showIndexingDesc ? "w-2/3" : "flex-1"}`}>
        {showIndexingDesc && (
          <span className="text-lightgray block truncate text-right text-xs">
            {update.desc}
          </span>
        )}
      </div>
    </div>
  );
}

export default IndexingProgressSubtext;
