import { CheckIcon, ClockIcon, StopIcon } from "@heroicons/react/24/outline";
import { StructuredAgentStepType } from "core";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { stopStructuredAgentWorkflowThunk } from "../../redux/thunks/structuredAgentWorkflow";
import { EnterButton } from "../mainInput/InputToolbar/EnterButton";
import { varWithFallback } from "../../styles/theme";

const WORKFLOW_STEPS: Array<{
  step: StructuredAgentStepType;
  title: string;
  description: string;
}> = [
  {
    step: "requirement-breakdown",
    title: "需求拆分",
    description: "分析并拆分复杂需求",
  },
  {
    step: "project-understanding",
    title: "项目理解",
    description: "了解项目结构和技术栈",
  },
  {
    step: "code-analysis",
    title: "代码分析",
    description: "分析相关代码和依赖",
  },
  {
    step: "plan-creation",
    title: "制定计划",
    description: "制定详细实施计划",
  },
  {
    step: "plan-execution",
    title: "执行计划",
    description: "执行代码修改",
  },
];

export default function StructuredAgentProgress() {
  const dispatch = useAppDispatch();
  const mode = useAppSelector((state) => state.session.mode);
  const structuredAgentWorkflow = useAppSelector(
    (state) => state.session.structuredAgentWorkflow,
  );

  const currentStepIndex = WORKFLOW_STEPS.findIndex(
    (step) => step.step === structuredAgentWorkflow.currentStep,
  );

  const currentStep = WORKFLOW_STEPS[currentStepIndex];

  const handleStopWorkflow = () => {
    dispatch(stopStructuredAgentWorkflowThunk());
  };

  return (
    <div className="flex h-full flex-col bg-background px-2 py-3">
      {/* 顶部标题和进度 */}
      <div className="mb-3 text-center">
        <div className="mb-1 flex items-center justify-center gap-2 text-xs font-medium text-foreground">
          <span>流程进度</span>
        </div>
        <div className="text-xs opacity-70" style={{ color: varWithFallback("foreground") }}>
          {structuredAgentWorkflow.stepIndex}/
          {structuredAgentWorkflow.totalSteps}
        </div>
      </div>

      {/* 当前步骤标题 */}
      {currentStep && (
        <div className="mb-3 px-1 text-center">
          <div className="mb-1 text-xs font-medium" style={{ color: varWithFallback("primary-background") }}>
            {currentStep.title}
          </div>
        </div>
      )}

      {/* 垂直进度节点 */}
      <div className="flex flex-1 flex-col items-center space-y-2">
        {WORKFLOW_STEPS.map((step, index) => {
          const isCompleted = index < currentStepIndex;
          const isCurrent = index === currentStepIndex;
          const isWaiting =
            structuredAgentWorkflow.isWaitingForConfirmation && isCurrent;

          return (
            <div
              key={step.step}
              className="group relative flex flex-col items-center"
            >
              {/* 节点 */}
              <div className="relative">
                <div
                  className="flex h-6 w-6 items-center justify-center rounded-full border-2 transition-all duration-300"
                  style={{
                    borderColor: isCompleted
                      ? varWithFallback("success")
                      : isCurrent
                        ? varWithFallback("primary-background")
                        : varWithFallback("border"),
                    backgroundColor: isCompleted
                      ? varWithFallback("success")
                      : isCurrent
                        ? varWithFallback("primary-background")
                        : varWithFallback("input-background"),
                  }}
                >
                  {isCompleted ? (
                    <CheckIcon className="h-3 w-3 text-white" />
                  ) : isCurrent ? (
                    <ClockIcon className="h-3 w-3 text-white" />
                  ) : (
                    <div
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: varWithFallback("foreground") }}
                    />
                  )}
                </div>

                {/* 等待确认指示器 */}
                {isWaiting && (
                  <div className="absolute -right-0.5 -top-0.5">
                    <div
                      className="h-2 w-2 animate-pulse rounded-full"
                      style={{ backgroundColor: varWithFallback("warning") }}
                    />
                  </div>
                )}

                {/* 悬停提示 */}
                <div
                  className="absolute bottom-7 left-[-15px] z-10 whitespace-nowrap rounded px-2 py-1 text-xs opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                  style={{
                    backgroundColor: varWithFallback("secondary-background"),
                    color: varWithFallback("secondary-foreground"),
                  }}
                >
                  {step.title}
                </div>
              </div>

              {/* 连接线 */}
              {index < WORKFLOW_STEPS.length - 1 && (
                <div
                  className="h-4 w-0.5 transition-all duration-300"
                  style={{
                    backgroundColor: index < currentStepIndex
                      ? varWithFallback("success")
                      : varWithFallback("border"),
                    opacity: index < currentStepIndex ? 0.6 : 1,
                  }}
                />
              )}
            </div>
          );
        })}
        {structuredAgentWorkflow.isActive && (
          <EnterButton
            variant="danger"
            className="text-description"
            onClick={handleStopWorkflow}
            data-testid="accept-tool-call-button"
          >
            终止流程
          </EnterButton>
        )}
        {/* 底部等待确认提示 */}
        {structuredAgentWorkflow.isWaitingForConfirmation && (
          <div className="mt-2 text-center">
            <div className="mb-1 text-xs" style={{ color: varWithFallback("foreground") }}>💬</div>
            <div className="text-xs leading-tight opacity-70" style={{ color: varWithFallback("foreground") }}>
              输入"确认"
              <br />
              或修改建议
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
