import { CheckIcon, ChevronDownIcon } from "@heroicons/react/24/outline";
import { MessageModes } from "core";
import { modelSupportsTools } from "core/llm/autodetect";
import { useCallback, useEffect, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { selectSelectedChatModel } from "../../redux/slices/configSlice";
import { setMode } from "../../redux/slices/sessionSlice";
import { getFontSize, getMetaKeyLabel } from "../../util";
import { useMainEditor } from "../mainInput/TipTapEditor";
import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from "../ui/Listbox";
import { ModeIcon } from "./ModeIcon";

export function ModeSelect() {
  const dispatch = useAppDispatch();
  const mode = useAppSelector((store) => store.session.mode);
  const selectedModel = useAppSelector(selectSelectedChatModel);
  const agentModeSupported = useMemo(() => {
    return selectedModel && modelSupportsTools(selectedModel);
  }, [selectedModel]);
  const { mainEditor } = useMainEditor();
  const metaKeyLabel = useMemo(() => {
    return getMetaKeyLabel();
  }, []);

  // Switch to chat mode if agent mode is selected but not supported
  useEffect(() => {
    if (!selectedModel) {
      return;
    }
    if (mode === "agent" && !agentModeSupported) {
      dispatch(setMode("chat"));
    }
  }, [mode, agentModeSupported, dispatch, selectedModel]);

  const cycleMode = useCallback(() => {
    const modes: MessageModes[] = ["chat", "agent", "structured-agent"];
    const currentIndex = modes.indexOf(mode);
    const nextIndex = (currentIndex + 1) % modes.length;
    dispatch(setMode(modes[nextIndex]));
    mainEditor?.commands.focus();
  }, [mode, mainEditor]);

  const selectMode = useCallback(
    (newMode: MessageModes) => {
      if (newMode === mode) {
        return;
      }

      dispatch(setMode(newMode));

      mainEditor?.commands.focus();
    },
    [mode, mainEditor],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "." && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void cycleMode();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [cycleMode]);

  return (
    <Listbox value={mode} onChange={selectMode}>
      <div className="relative">
        <ListboxButton
          data-testid="mode-select-button"
          className="xs:px-2 primary-hover gap-1 rounded-full border-none px-1.5 py-0.5 transition-colors duration-200 hover:brightness-110"
        >
          <ModeIcon mode={mode} />
          <span className="hidden sm:block">
            {mode === "chat"
              ? "聊天"
              : mode === "structured-agent"
                ? "流程化智能体"
                : "智能体"}
          </span>
          <ChevronDownIcon
            className="h-2 w-2 flex-shrink-0"
            aria-hidden="true"
          />
        </ListboxButton>
        <ListboxOptions className="min-w-32 max-w-48">
          <ListboxOption value="chat">
            <div className="flex flex-row items-center gap-1.5">
              <ModeIcon mode="chat" />
              <span className="">聊天</span>
              <span
                className={`text-description-muted text-[${getFontSize() - 3}px] mr-auto`}
              >
                {getMetaKeyLabel()}L
              </span>
            </div>
            {mode === "chat" && <CheckIcon className="ml-auto h-3 w-3" />}
          </ListboxOption>

          <ListboxOption
            value="agent"
            disabled={!agentModeSupported}
            className={"gap-1"}
          >
            <div className="flex flex-row items-center gap-1.5">
              <ModeIcon mode="agent" />
              <span className="">智能体(常规任务)</span>
            </div>
            {agentModeSupported ? (
              mode === "agent" && <CheckIcon className="ml-auto h-3 w-3" />
            ) : (
              <span>(Not supported)</span>
            )}
          </ListboxOption>

          <ListboxOption
            value="structured-agent"
            disabled={!agentModeSupported}
            className={"gap-1"}
          >
            <div className="flex flex-row items-center gap-1.5">
              <ModeIcon mode="structured-agent" />
              <span className="">流程化智能体(复杂需求)</span>
            </div>
            {agentModeSupported ? (
              mode === "structured-agent" && (
                <CheckIcon className="ml-auto h-3 w-3" />
              )
            ) : (
              <span>(Not supported)</span>
            )}
          </ListboxOption>

          <div className="text-description-muted px-2 py-1">
            {`${metaKeyLabel} . 切换模式`}
          </div>
        </ListboxOptions>
      </div>
    </Listbox>
  );
}
