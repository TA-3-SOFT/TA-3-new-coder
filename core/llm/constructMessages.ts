import {
  BrowserSerializedContinueConfig,
  ChatHistoryItem,
  ChatMessage,
  ContextItemWithId,
  RuleWithSource,
  TextMessagePart,
  ToolResultChatMessage,
  UserChatMessage,
} from "../";
import { findLast } from "../util/findLast";
import { normalizeToMessageParts } from "../util/messageContent";
import { isUserOrToolMsg } from "./messages";
import { getSystemMessageWithRules } from "./rules/getSystemMessageWithRules";

export const DEFAULT_CHAT_SYSTEM_MESSAGE_URL =
  "https://github.com/continuedev/continue/blob/main/core/llm/constructMessages.ts";

export const DEFAULT_AGENT_SYSTEM_MESSAGE_URL =
  "https://github.com/continuedev/continue/blob/main/core/llm/constructMessages.ts";

export const DEFAULT_STRUCTURED_AGENT_SYSTEM_MESSAGE_URL =
  "https://github.com/continuedev/continue/blob/main/core/llm/constructMessages.ts";

const EDIT_MESSAGE = `\
  Always include the language and file name in the info string when you write code blocks.
  If you are editing "src/main.py" for example, your code block should start with '\`\`\`python src/main.py'

  When addressing code modification requests, present a concise code snippet that
  emphasizes only the necessary changes and uses abbreviated placeholders for
  unmodified sections. For example:

  \`\`\`language /path/to/file
  // ... existing code ...

  {{ modified code here }}

  // ... existing code ...

  {{ another modification }}

  // ... rest of code ...
  \`\`\`

  In existing files, you should always restate the function or class that the snippet belongs to:

  \`\`\`language /path/to/file
  // ... existing code ...

  function exampleFunction() {
    // ... existing code ...

    {{ modified code here }}

    // ... rest of function ...
  }

  // ... rest of code ...
  \`\`\`

  Since users have access to their complete file, they prefer reading only the
  relevant modifications. It's perfectly acceptable to omit unmodified portions
  at the beginning, middle, or end of files using these "lazy" comments. Only
  provide the complete file when explicitly requested. Include a concise explanation
  of changes unless the user specifically asks for code only.
`;

export const DEFAULT_CHAT_SYSTEM_MESSAGE = `\
<important_rules>
你是一个专业的AI编程助手，工作在聊天模式下，用中文回答。

如果用户要求更改文件，请提示使用代码块上的应用按钮，或切换到代理模式以自动进行建议的更新。
如果需要，简要地向用户解释他们可以使用模式选择器下拉菜单切换到代理模式。

${EDIT_MESSAGE}
</important_rules>`;

export const DEFAULT_AGENT_SYSTEM_MESSAGE = `\
<important_rules>
你是一个专业的AI编程助手，工作在agent模式下，用中文回答。

在Agent模式下，你可以调用外部工具来增强你的能力，例如读写文件、搜索信息等。你的目标是提供准确、高效、安全的编程支持。
你的核心任务是帮助用户解决软件开发的问题，如代码阅读、检索、生成、编写、调试、优化、解释等。
</important_rules>`;

export const DEFAULT_STRUCTURED_AGENT_SYSTEM_MESSAGE = ``;

/**
 * Helper function to get the context items for a user message
 */
function getUserContextItems(
  userMsg: UserChatMessage | ToolResultChatMessage | undefined,
  history: ChatHistoryItem[],
): ContextItemWithId[] {
  if (!userMsg) return [];

  // Find the history item that contains the userMsg
  const historyItem = history.find((item) => {
    // Check if the message ID matches
    if ("id" in userMsg && "id" in item.message) {
      return (item.message as any).id === (userMsg as any).id;
    }
    // Fallback to content comparison
    return (
      item.message.content === userMsg.content &&
      item.message.role === userMsg.role
    );
  });

  return historyItem?.contextItems || [];
}

export function constructMessages(
  messageMode: string,
  history: ChatHistoryItem[],
  baseChatOrAgentSystemMessage: string | undefined,
  rules: RuleWithSource[],
  config: BrowserSerializedContinueConfig, // 添加config参数
  dynamicSystemMessage?: string, // 添加动态系统消息参数
): ChatMessage[] {
  const filteredHistory = history.filter(
    (item) => item.message.role !== "system",
  );
  const msgs: ChatMessage[] = [];

  for (let i = 0; i < filteredHistory.length; i++) {
    const historyItem = filteredHistory[i];

    // 使用配置项来决定是否在Chat模式下过滤工具调用
    if (messageMode === "chat" && !(config.keepToolCallsInChatMode ?? false)) {
      const toolMessage: ToolResultChatMessage =
        historyItem.message as ToolResultChatMessage;
      if (historyItem.toolCallState?.toolCallId || toolMessage.toolCallId) {
        // remove all tool calls from the history
        continue;
      }
    }

    if (historyItem.message.role === "user") {
      // Gather context items for user messages
      let content = normalizeToMessageParts(historyItem.message);

      const ctxItems = historyItem.contextItems
        .map((ctxItem) => {
          return {
            type: "text",
            text: `${ctxItem.content}\n`,
          } as TextMessagePart;
        })
        .filter((part) => !!part.text.trim());

      content = [...ctxItems, ...content];
      msgs.push({
        ...historyItem.message,
        content,
      });
    } else {
      msgs.push(historyItem.message);
    }
  }

  const lastUserMsg = findLast(msgs, isUserOrToolMsg) as
    | UserChatMessage
    | ToolResultChatMessage
    | undefined;

  // Get context items for the last user message
  const lastUserContextItems = getUserContextItems(
    lastUserMsg,
    filteredHistory,
  );
  let systemMessage = getSystemMessageWithRules({
    baseSystemMessage: baseChatOrAgentSystemMessage,
    rules,
    userMessage: lastUserMsg,
    contextItems: lastUserContextItems,
  });

  // 如果有动态系统消息，将其合并到系统消息中
  if (dynamicSystemMessage && dynamicSystemMessage.trim()) {
    systemMessage = systemMessage.trim()
      ? `${dynamicSystemMessage}\n\n${systemMessage}`
      : dynamicSystemMessage;
    // systemMessage = dynamicSystemMessage;
  }

  if (systemMessage.trim()) {
    msgs.unshift({
      role: "system",
      content: systemMessage,
    });
  }

  // Remove the "id" from all of the messages
  return msgs.map((msg) => {
    const { id, ...rest } = msg as any;
    return rest;
  });
}
