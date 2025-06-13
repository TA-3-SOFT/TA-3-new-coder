import { AnimatedEllipsis } from "../../..";

export function GeneratingIndicator({ text = "生成中" }: { text?: string }) {
  return (
    <div className="text-description-muted text-xs">
      <span>{text}</span>
      <AnimatedEllipsis />
    </div>
  );
}
