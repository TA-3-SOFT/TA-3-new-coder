import { IndexingProgressUpdate } from "core";
import { AnimatedEllipsis } from "../../../components";

export interface IndexingProgressTitleTextProps {
  update: IndexingProgressUpdate;
}

const STATUS_TO_TEXT: Record<IndexingProgressUpdate["status"], string> = {
  done: "索引完成",
  loading: "初始化中",
  indexing: "索引进行中",
  paused: "索引已暂停",
  failed: "索引失败",
  disabled: "索引已禁用",
  cancelled: "索引已取消",
};

function IndexingProgressTitleText({ update }: IndexingProgressTitleTextProps) {
  const showEllipsis = update.status === "loading";

  return (
    <span>
      {STATUS_TO_TEXT[update.status]}
      {showEllipsis && <AnimatedEllipsis />}
    </span>
  );
}

export default IndexingProgressTitleText;
