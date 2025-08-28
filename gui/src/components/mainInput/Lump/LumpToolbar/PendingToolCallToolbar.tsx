import styled from "styled-components";
import { useAppDispatch, useAppSelector } from "../../../../redux/hooks";
import {
  callCurrentTool,
  cancelCurrentToolCall,
} from "../../../../redux/thunks";
import {
  getAltKeyLabel,
  getFontSize,
  getMetaKeyLabel,
  isJetBrains,
} from "../../../../util";
import { EnterButton } from "../../InputToolbar/EnterButton";

const Container = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
`;

const StopButton = styled.div`
  font-size: ${getFontSize() - 3}px;
  padding: 2px;
  padding-right: 4px;
  cursor: pointer;
`;

export function PendingToolCallToolbar() {
  const dispatch = useAppDispatch();
  const jetbrains = isJetBrains();
  const fullyAutomaticEditMode = useAppSelector(
    (state) => state.config.config.ui?.fullyAutomaticEditMode ?? false,
  );

  // In fully automatic edit mode, don't show the toolbar at all
  if (fullyAutomaticEditMode) {
    return (
      <Container>
        <div className="text-description flex flex-row items-center pb-0.5 pr-1 text-xs">
          <span className="hidden sm:flex">
            统一修改模式 - 工具自动执行中...
          </span>
        </div>
      </Container>
    );
  }

  return (
    <Container>
      <div className="text-description flex flex-row items-center pb-0.5 pr-1 text-xs">
        <span className="hidden sm:flex">工具调用确认</span>
      </div>

      <div className="flex gap-2 pb-0.5">
        <StopButton
          className="text-description"
          onClick={() => dispatch(cancelCurrentToolCall())}
          data-testid="reject-tool-call-button"
        >
          {/* JetBrains overrides cmd+backspace, so we have to use another shortcut */}
          {jetbrains ? getAltKeyLabel() : getMetaKeyLabel()} ⌫ 取消
        </StopButton>
        <EnterButton
          isPrimary={true}
          className="text-description"
          onClick={() => dispatch(callCurrentTool())}
          data-testid="accept-tool-call-button"
        >
          {getMetaKeyLabel()} ⏎ 继续
        </EnterButton>
      </div>
    </Container>
  );
}
