import {
  BarsArrowDownIcon,
  PencilIcon,
  TrashIcon,
  ArrowUturnLeftIcon,
} from "@heroicons/react/24/outline";
import { ChatHistoryItem } from "core";
import { renderChatMessage } from "core/util/messageContent";
import { useDispatch } from "react-redux";
import ConfirmationDialog from "../dialogs/ConfirmationDialog";
import FeedbackButtons from "../FeedbackButtons";
import { CopyIconButton } from "../gui/CopyIconButton";
import HeaderButtonWithToolTip from "../gui/HeaderButtonWithToolTip";
import { EnterButton } from "../mainInput/InputToolbar/EnterButton";
import { ToolTip } from "../gui/Tooltip";
import { setDialogMessage, setShowDialog } from "../../redux/slices/uiSlice";
import { useAppSelector } from "../../redux/hooks";

export interface ResponseActionsProps {
  isTruncated: boolean;
  onContinueGeneration: () => void;
  index: number;
  onDelete: () => void;
  onEdit?: () => void;
  onRollback: () => void;
  item: ChatHistoryItem;
  isLast: boolean; // 添加isLast属性来判断是否是最新的回答
}

export default function ResponseActions({
  onContinueGeneration,
  index,
  item,
  isTruncated,
  onDelete,
  onEdit,
  onRollback,
  isLast,
}: ResponseActionsProps) {
  const dispatch = useDispatch();
  const mode = useAppSelector((state) => state.session.mode);
  const structuredAgentWorkflow = useAppSelector((state) => state.session.structuredAgentWorkflow);

  // 在流程化智能体模式下，只在最新的回答中显示确认和编辑按钮
  const shouldShowEditButtons = mode === "structured-agent" &&
    structuredAgentWorkflow.isActive &&
    isLast;

  const handleRollbackClick = () => {
    dispatch(setShowDialog(true));
    dispatch(
      setDialogMessage(
        <ConfirmationDialog
          title="确认回滚"
          text="回滚后将放弃本次回答的所有文件更改操作，确定要执行此次回滚吗？"
          confirmText="回滚"
          onConfirm={() => {
            onRollback();
          }}
        />,
      ),
    );
  };
  return (
    <div className="mx-2 flex cursor-default items-center justify-end space-x-1 bg-transparent pb-0 text-xs text-gray-400">
      {onEdit && shouldShowEditButtons && (
        <EnterButton
          variant={"success"}
          data-tooltip-id="next-step"
          onClick={onContinueGeneration}
          data-testid="accept-tool-call-button"
        >
          <BarsArrowDownIcon className="h-3.5 w-3.5" />
          确认
          <ToolTip id="next-step" place="bottom">
            执行下一步
          </ToolTip>
        </EnterButton>
      )}

      {onEdit && shouldShowEditButtons && (
        <EnterButton
          variant={"warning"}
          data-tooltip-id="edit-answer"
          onClick={onEdit}
          data-testid="accept-tool-call-button"
        >
          <PencilIcon className="h-3.5 w-3.5" />
          编辑
          <ToolTip id="edit-answer" place="bottom">
            编辑回答
          </ToolTip>
        </EnterButton>
      )}

      {/*      {onEdit && (
        <HeaderButtonWithToolTip
          testId={`edit-button-${index}`}
          text="编辑回答"
          tabIndex={-1}
          onClick={onEdit}
        >
          <PencilIcon className="h-3.5 w-3.5 text-pink-500" />
        </HeaderButtonWithToolTip>
      )}*/}

      {/*      {isTruncated && (
        <HeaderButtonWithToolTip
          tabIndex={-1}
          text="继续生成"
          onClick={onContinueGeneration}
        >
          <BarsArrowDownIcon className="h-3.5 w-3.5 text-gray-500" />
        </HeaderButtonWithToolTip>
      )}*/}

      <HeaderButtonWithToolTip
        testId={`rollback-button-${index}`}
        text="回滚"
        tabIndex={-1}
        onClick={handleRollbackClick}
      >
        <ArrowUturnLeftIcon className="h-3.5 w-3.5 text-gray-500" />
      </HeaderButtonWithToolTip>

      <HeaderButtonWithToolTip
        testId={`delete-button-${index}`}
        text="删除"
        tabIndex={-1}
        onClick={onDelete}
      >
        <TrashIcon className="h-3.5 w-3.5 text-gray-500" />
      </HeaderButtonWithToolTip>

      <CopyIconButton
        tabIndex={-1}
        text={renderChatMessage(item.message)}
        clipboardIconClassName="h-3.5 w-3.5 text-gray-500"
        checkIconClassName="h-3.5 w-3.5 text-green-400"
      />

      <FeedbackButtons item={item} />
    </div>
  );
}
