import { useMemo } from "react";
import Shortcut from "../../components/gui/Shortcut";
import { isJetBrains } from "../../util";

interface KeyboardShortcutProps {
  shortcut: string;
  description: string;
  isEven: boolean;
}

function KeyboardShortcut(props: KeyboardShortcutProps) {
  return (
    <div
      className={`flex flex-col items-start p-2 py-2 sm:flex-row sm:items-center ${props.isEven ? "" : "bg-table-oddRow"}`}
    >
      <div className="w-full flex-grow pb-1 pr-4 sm:w-auto sm:pb-0">
        <span className="block break-words text-xs">{props.description}:</span>
      </div>
      <div className="flex-shrink-0 whitespace-nowrap">
        <Shortcut>{props.shortcut}</Shortcut>
      </div>
    </div>
  );
}

// Shortcut strings will be rendered correctly based on the platform by the Shortcut component
const vscodeShortcuts: Omit<KeyboardShortcutProps, "isEven">[] = [
  {
    shortcut: "cmd '",
    description: "Toggle Selected Model",
  },
  {
    shortcut: "cmd I",
    description: "Edit highlighted code",
  },
  {
    shortcut: "cmd L",
    description:
      "New Chat / New Chat With Selected Code / Close Continue Sidebar If Chat Already In Focus",
  },
  {
    shortcut: "cmd backspace",
    description: "Cancel response",
  },
  {
    shortcut: "cmd shift I",
    description: "Toggle inline edit focus",
  },
  {
    shortcut: "cmd shift L",
    description:
      "Focus Current Chat / Add Selected Code To Current Chat / Close Continue Sidebar If Chat Already In Focus",
  },
  {
    shortcut: "cmd shift R",
    description: "Debug Terminal",
  },
  {
    shortcut: "cmd shift backspace",
    description: "Reject Diff",
  },
  {
    shortcut: "cmd shift enter",
    description: "Accept Diff",
  },
  {
    shortcut: "alt cmd N",
    description: "Reject Top Change in Diff",
  },
  {
    shortcut: "alt cmd Y",
    description: "Accept Top Change in Diff",
  },
  {
    shortcut: "cmd K cmd A",
    description: "Toggle Autocomplete Enabled",
  },
  {
    shortcut: "cmd K cmd M",
    description: "Toggle Full Screen",
  },
];

const jetbrainsShortcuts: Omit<KeyboardShortcutProps, "isEven">[] = [
  {
    shortcut: "cmd '",
    description: "切换模型",
  },
  {
    shortcut: "cmd I",
    description: "编辑选中的代码",
  },
  {
    shortcut: "cmd J",
    description: "新聊天 / 与选定代码的新聊天 / 如果聊天已经聚焦则关闭侧边栏",
  },
  {
    shortcut: "cmd backspace",
    description: "取消响应",
  },
  {
    shortcut: "cmd shift I",
    description: "切换行内编辑焦点",
  },
  {
    shortcut: "cmd shift J",
    description:
      "聚焦当前聊天 / 将选定代码添加到当前聊天 / 如果聊天已在聚焦中则关闭侧边栏",
  },
  {
    shortcut: "cmd shift backspace",
    description: "拒绝变更",
  },
  {
    shortcut: "cmd shift enter",
    description: "接受变更",
  },
  {
    shortcut: "alt shift J",
    description: "快速输入",
  },
  {
    shortcut: "alt cmd J",
    description: "切换侧边栏",
  },
];

function KeyboardShortcuts() {
  const shortcuts = useMemo(() => {
    return isJetBrains() ? jetbrainsShortcuts : vscodeShortcuts;
  }, []);

  return (
    <div className="h-full overflow-auto p-5">
      <h3 className="mb-5 text-xl">键盘快捷键</h3>
      <div>
        {shortcuts.map((shortcut, i) => {
          return (
            <KeyboardShortcut
              key={i}
              shortcut={shortcut.shortcut}
              description={shortcut.description}
              isEven={i % 2 === 0}
            />
          );
        })}
      </div>
    </div>
  );
}

export default KeyboardShortcuts;
