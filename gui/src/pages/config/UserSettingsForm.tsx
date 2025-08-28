import {
  CheckIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import {
  SharedConfigSchema,
  modifyAnyConfigWithSharedConfig,
} from "core/config/sharedConfig";
import { useContext, useEffect, useState } from "react";
import { Input } from "../../components";
import NumberInput from "../../components/gui/NumberInput";
import { Select } from "../../components/gui/Select";
import ToggleSwitch from "../../components/gui/Switch";
import { ToolTip } from "../../components/gui/Tooltip";
import { useFontSize } from "../../components/ui/font";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { updateConfig } from "../../redux/slices/configSlice";
import { setLocalStorage } from "../../util/localStorage";

export function UserSettingsForm() {
  /////// User settings section //////
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const config = useAppSelector((state) => state.config.config);
  const [showExperimental, setShowExperimental] = useState(false);

  function handleUpdate(sharedConfig: SharedConfigSchema) {
    // Optimistic update
    const updatedConfig = modifyAnyConfigWithSharedConfig(config, sharedConfig);
    dispatch(updateConfig(updatedConfig));
    // IMPORTANT no need for model role updates (separate logic for selected model roles)
    // simply because this function won't be used to update model roles

    // Actual update to core which propagates back with config update event
    ideMessenger.post("config/updateSharedConfig", sharedConfig);
  }

  // Disable autocomplete
  const disableAutocompleteInFiles = (
    config.tabAutocompleteOptions?.disableInFiles ?? []
  ).join(", ");
  const [formDisableAutocomplete, setFormDisableAutocomplete] = useState(
    disableAutocompleteInFiles,
  );

  useEffect(() => {
    // Necessary so that reformatted/trimmed values don't cause dirty state
    setFormDisableAutocomplete(disableAutocompleteInFiles);
  }, [disableAutocompleteInFiles]);

  // Workspace prompts
  const promptPath = config.experimental?.promptPath || "";
  const [formPromptPath, setFormPromptPath] = useState(promptPath);
  const cancelChangePromptPath = () => {
    setFormPromptPath(promptPath);
  };
  const handleSubmitPromptPath = () => {
    handleUpdate({
      promptPath: formPromptPath || "",
    });
  };

  useEffect(() => {
    // Necessary so that reformatted/trimmed values don't cause dirty state
    setFormPromptPath(promptPath);
  }, [promptPath]);

  // TODO defaults are in multiple places, should be consolidated and probably not explicit here
  const showSessionTabs = config.ui?.showSessionTabs ?? false;
  const codeWrap = config.ui?.codeWrap ?? false;
  const showChatScrollbar = config.ui?.showChatScrollbar ?? false;
  const readResponseTTS = config.experimental?.readResponseTTS ?? false;
  const autoAcceptEditToolDiffs = config.ui?.autoAcceptEditToolDiffs ?? false;
  const fullyAutomaticEditMode = config.ui?.fullyAutomaticEditMode ?? false;
  const displayRawMarkdown = config.ui?.displayRawMarkdown ?? false;
  const disableSessionTitles = config.disableSessionTitles ?? false;
  const keepToolCallsInChatMode = config.keepToolCallsInChatMode ?? false;
  const useCurrentFileAsContext =
    config.experimental?.useCurrentFileAsContext ?? false;

  const disableIndexing = config.disableIndexing ?? false;

  // const useAutocompleteCache = config.tabAutocompleteOptions?.useCache ?? true;
  // const useChromiumForDocsCrawling =
  //   config.experimental?.useChromiumForDocsCrawling ?? false;
  // const codeBlockToolbarPosition = config.ui?.codeBlockToolbarPosition ?? "top";
  const useAutocompleteMultilineCompletions =
    config.tabAutocompleteOptions?.multilineCompletions ?? "auto";
  const modelTimeout = config.tabAutocompleteOptions?.modelTimeout ?? 150;
  const debounceDelay = config.tabAutocompleteOptions?.debounceDelay ?? 250;
  const fontSize = useFontSize();

  const cancelChangeDisableAutocomplete = () => {
    setFormDisableAutocomplete(disableAutocompleteInFiles);
  };
  const handleDisableAutocompleteSubmit = () => {
    handleUpdate({
      disableAutocompleteInFiles: formDisableAutocomplete
        .split(",")
        .map((val) => val.trim())
        .filter((val) => !!val),
    });
  };

  const [hubEnabled, setHubEnabled] = useState(false);
  useEffect(() => {
    ideMessenger.ide.getIdeSettings().then(({ continueTestEnvironment }) => {
      setHubEnabled(continueTestEnvironment === "production");
    });
  }, [ideMessenger]);

  return (
    <div className="flex flex-col">
      {/* {selectedProfile && isLocalProfile(selectedProfile) ? (
        <div className="flex items-center justify-center">
          <SecondaryButton
            className="flex flex-row items-center gap-1"
            onClick={() => {
              ideMessenger.post("config/openProfile", {
                profileId: selectedProfile.id,
              });
            }}
          >
            <span>Open</span>
            <span>Config</span>
            <span className="xs:flex hidden">File</span>
          </SecondaryButton>
        </div>
      ) : null} */}
      {hubEnabled ? (
        <div className="flex flex-col gap-4 py-4">
          <div>
            <h2 className="mb-2 mt-0 p-0">用户设置</h2>
          </div>

          <div className="flex flex-col gap-4">
            <ToggleSwitch
              isToggled={showSessionTabs}
              onToggle={() =>
                handleUpdate({
                  showSessionTabs: !showSessionTabs,
                })
              }
              text="显示会话标签页"
            />
            <ToggleSwitch
              isToggled={codeWrap}
              onToggle={() =>
                handleUpdate({
                  codeWrap: !codeWrap,
                })
              }
              text="代码块展示自动换行"
            />

            <ToggleSwitch
              isToggled={showChatScrollbar}
              onToggle={() =>
                handleUpdate({
                  showChatScrollbar: !showChatScrollbar,
                })
              }
              text="显示聊天窗口滚动条"
            />
            {/*            <ToggleSwitch
              isToggled={readResponseTTS}
              onToggle={() =>
                handleUpdate({
                  readResponseTTS: !readResponseTTS,
                })
              }
              text="Text-to-Speech Output"
            />*/}
            {/* <ToggleSwitch
                    isToggled={useChromiumForDocsCrawling}
                    onToggle={() =>
                      handleUpdate({
                        useChromiumForDocsCrawling: !useChromiumForDocsCrawling,
                      })
                    }
                    text="Use Chromium for Docs Crawling"
                  /> */}
            <ToggleSwitch
              isToggled={!disableSessionTitles}
              onToggle={() =>
                handleUpdate({
                  disableSessionTitles: !disableSessionTitles,
                })
              }
              text="启用会话标题自动生成"
            />
            <ToggleSwitch
              isToggled={!displayRawMarkdown}
              onToggle={() =>
                handleUpdate({
                  displayRawMarkdown: !displayRawMarkdown,
                })
              }
              text="格式化 Markdown"
            />

            <ToggleSwitch
              isToggled={!disableIndexing}
              onToggle={() =>
                handleUpdate({
                  disableIndexing: !disableIndexing,
                })
              }
              text="启用代码索引"
            />
            <ToggleSwitch
              isToggled={keepToolCallsInChatMode}
              onToggle={() =>
                handleUpdate({
                  keepToolCallsInChatMode: !keepToolCallsInChatMode,
                })
              }
              text="允许Chat模式使用读取工具"
            />
            <ToggleSwitch
              isToggled={useCurrentFileAsContext}
              onToggle={() =>
                handleUpdate({
                  useCurrentFileAsContext: !useCurrentFileAsContext,
                })
              }
              text="将当前文件默认作为上下文"
            />
            <ToggleSwitch
              isToggled={autoAcceptEditToolDiffs}
              onToggle={() =>
                handleUpdate({
                  autoAcceptEditToolDiffs: !autoAcceptEditToolDiffs,
                })
              }
              text="自动接受智能体的修改"
              showIfToggled={
                <>
                  <ExclamationTriangleIcon
                    data-tooltip-id={`auto-accept-diffs-warning-tooltip`}
                    className="h-3 w-3 text-yellow-500"
                  />
                  <ToolTip id={`auto-accept-diffs-warning-tooltip`}>
                    {`注意：当启用时，智能体模式的编辑工具对文件进行修改后，会跳过人工确认步骤，自动接受修改内容。`}
                  </ToolTip>
                </>
              }
            />
            <ToggleSwitch
              isToggled={fullyAutomaticEditMode}
              onToggle={() =>
                handleUpdate({
                  fullyAutomaticEditMode: !fullyAutomaticEditMode,
                })
              }
              text="统一修改模式"
              showIfToggled={
                <>
                  <ExclamationTriangleIcon
                    data-tooltip-id={`auto-accept-diffs-warning-tooltip`}
                    className="h-3 w-3 text-yellow-500"
                  />
                  <ToolTip id={`fully-automatic-edit-mode-warning-tooltip`}>
                    {`警告：启用后，模型修改文件时将直接修改文件，无需任何确认操作，在全部修改完成后，会弹出统一确认框进行用户确认操作。`}
                  </ToolTip>
                </>
              }
            />

            {/* <ToggleSwitch
                    isToggled={useAutocompleteCache}
                    onToggle={() =>
                      handleUpdate({
                        useAutocompleteCache: !useAutocompleteCache,
                      })
                    }
                    text="Use Autocomplete Cache"
                  /> */}

            <label className="flex items-center justify-between gap-3">
              <span className="text-left">字体大小</span>
              <NumberInput
                value={fontSize}
                onChange={(val) => {
                  setLocalStorage("fontSize", val);
                  handleUpdate({
                    fontSize: val,
                  });
                }}
                min={7}
                max={50}
              />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span className="lines lines-1 text-left">多行自动补全</span>
              <Select
                value={useAutocompleteMultilineCompletions}
                onChange={(e) =>
                  handleUpdate({
                    useAutocompleteMultilineCompletions: e.target.value as
                      | "auto"
                      | "always"
                      | "never",
                  })
                }
              >
                <option value="auto">自动</option>
                <option value="always">总是</option>
                <option value="never">永不</option>
              </Select>
            </label>
            <label className="flex items-center justify-between gap-3">
              <span className="text-left">自动补全超时 (ms)</span>
              <NumberInput
                value={modelTimeout}
                onChange={(val) =>
                  handleUpdate({
                    modelTimeout: val,
                  })
                }
                min={100}
                max={5000}
              />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span className="text-left">自动补全延迟 (ms)</span>
              <NumberInput
                value={debounceDelay}
                onChange={(val) =>
                  handleUpdate({
                    debounceDelay: val,
                  })
                }
                min={0}
                max={2500}
              />
            </label>
            <form
              className="flex flex-col gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                handleDisableAutocompleteSubmit();
              }}
            >
              <div className="flex items-center justify-between">
                <span>禁用自动补全的文件</span>
                <div className="flex items-center gap-2">
                  <Input
                    value={formDisableAutocomplete}
                    className="max-w-[100px]"
                    onChange={(e) => {
                      setFormDisableAutocomplete(e.target.value);
                    }}
                  />
                  <div className="flex h-full flex-col">
                    {formDisableAutocomplete !== disableAutocompleteInFiles ? (
                      <>
                        <div
                          onClick={handleDisableAutocompleteSubmit}
                          className="cursor-pointer"
                        >
                          <CheckIcon className="h-4 w-4 text-green-500 hover:opacity-80" />
                        </div>
                        <div
                          onClick={cancelChangeDisableAutocomplete}
                          className="cursor-pointer"
                        >
                          <XMarkIcon className="h-4 w-4 text-red-500 hover:opacity-80" />
                        </div>
                      </>
                    ) : (
                      <div>
                        <CheckIcon className="text-vsc-foreground-muted h-4 w-4" />
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <span className="text-vsc-foreground-muted text-lightgray self-end text-xs">
                以逗号分隔的路径匹配列表
              </span>
            </form>
          </div>
          {/*<div className="flex flex-col gap-x-2 gap-y-4">
            <div
              className="flex cursor-pointer items-center gap-2 text-left text-sm font-semibold"
              onClick={() => setShowExperimental(!showExperimental)}
            >
              <ChevronRightIcon
                className={`h-4 w-4 transition-transform ${
                  showExperimental ? "rotate-90" : ""
                }`}
              />
              <span>实验性设置</span>
            </div>
            <div
              className={`duration-400 overflow-hidden transition-all ease-in-out ${
                showExperimental ? "max-h-40" : "max-h-0"
              }`}
            >
              <div className="flex flex-col gap-x-1 gap-y-4 pl-6">
                <ToggleSwitch
                  isToggled={autoAcceptEditToolDiffs}
                  onToggle={() =>
                    handleUpdate({
                      autoAcceptEditToolDiffs: !autoAcceptEditToolDiffs,
                    })
                  }
                  text="自动接受智能体的修改"
                  showIfToggled={
                    <>
                      <ExclamationTriangleIcon
                        data-tooltip-id={`auto-accept-diffs-warning-tooltip`}
                        className="h-3 w-3 text-yellow-500"
                      />
                      <ToolTip id={`auto-accept-diffs-warning-tooltip`}>
                        {`注意：当启用时，代理模式的编辑工具可以对文件进行更改，而无需手动审核或保证停止点。`}
                      </ToolTip>
                    </>
                  }
                />

                <ToggleSwitch
                  isToggled={useCurrentFileAsContext}
                  onToggle={() =>
                    handleUpdate({
                      useCurrentFileAsContext: !useCurrentFileAsContext,
                    })
                  }
                  text="将当前文件默认作为上下文"
                />
              </div>
            </div>
          </div>*/}
        </div>
      ) : null}
    </div>
  );
}
