# TA+3 NewCoder

The leading open-source AI code assistant.

TA+3 NewCoder helps you code faster with AI autocomplete, chat, and edits integrated directly into your IDE.

Supports VS Code, JetBrains, and more. Works with any LLM provider (OpenAI, Anthropic, Gemini, Grok, etc.).

## Overview

This project is an open-source AI coding assistant, extending Continue.dev. It enhances developer productivity through AI-powered features integrated into IDEs like VS Code and IntelliJ.

Core functionalities include:
- Code autocomplete with context-aware suggestions.
- Chat-based assistance for code generation, explanation, and debugging.
- Retrieval-Augmented Generation (RAG) for codebase and knowledge querying.
- Diff-based code editing and application.
- Knowledge base management with external document indexing.

Recent enhancements include support for advanced models like Gemini 2.5 and Grok, a new knowledge module, RAG query tools, and automated configuration refresh.

## Features

- **Model Support**: Integrations with 40+ LLMs including OpenAI, Gemini (2.5), Grok/xAI, Anthropic, Cohere, Mistral, AWS Bedrock, Azure, Ollama (local), and more. Supports chat completions, embeddings, fine-tuning, and tool calls. Model selection prioritizes long-context configurations.

- **Code Autocomplete**: Real-time suggestions with templating, filtering (bracket matching, line streaming), context retrieval (imports, root path), ranking, and caching. Multi-language support.

- **Chat and Assistance**: Streaming chat interfaces with templates, tool support, slash commands (/onboard, /mcp, /review), and custom assistants via SDK. Guided responses using rules and system messages.

- **RAG and Knowledge Base**: Vector indexing with LanceDB for code snippets and documents. Tools for repo/knowledge queries; knowledge module with context providers and doc crawling (Chromium). Project memory generation.

- **Code Editing**: Diff-based edits via NextEditProvider; streaming application with lazy/recursive handling. Quick edits and vertical diffs in IDEs.

- **Tools and Integrations**: Built-in tools (terminal commands, project memory); MCP for dynamic context; slash commands for onboarding and reviews.

- **Configuration and Automation**: YAML-based configs for models, profiles, tools; auto-refresh every hour with resource cleanup; shared configs and onboarding.

- **IDE Integrations**: VS Code extension with webviews, commands, status bars, e2e tests; IntelliJ plugin with tutorials.

- **Other**: On-device embeddings (Transformers.js); logging/telemetry; free trial helpers; dev data storage (SQLite).

## Architecture

- **Core Layer** (core/): Node.js backend for LLM calls, RAG indexing, tool execution, config management, and IPC protocol (JSON-RPC-like).

- **GUI Layer** (gui/): React/Redux frontend for chat sessions, streaming, and user interactions; integrates with core via messengers.

- **Extensions Layer** (extensions/): IDE plugins (VS Code, IntelliJ) proxying requests to core/binary.

- **Binary Layer** (binary/): Cross-platform builds and executables for core services/IPC.

- **Shared Packages** (packages/): Modular adapters, SDK, configs.

Data flow: Config → Core initializes → IDE/GUI requests → Core streams responses → Apply in editor.

## Installation

### Prerequisites
- Node.js >= 20.19.0 (use .nvmrc).
- npm/yarn.
- VS Code or JetBrains IDE.

### Setup
1. Clone the repo:
   ```bash
git clone <repo-url>
cd TA-3-new-coder
```

2. Install dependencies:
   ```bash
npm install
# Subdirs if needed
cd core && npm install && cd ..
cd gui && npm install && cd ..
cd extensions/vscode && npm install && cd ../../
```

3. Compile TypeScript (dev):
   ```bash
npm run tsc:watch
```

4. VS Code Extension:
   - Build: `cd extensions/vscode && npm run package`
   - Install the .vsix in VS Code.

5. IntelliJ: Build plugin from source.

6. Config (~/.TA+3 NewCoder/config.yaml):
   ```yaml
models:
  - title: Gemini 2.5
    provider: gemini
    model: gemini-2.5-pro
    apiKey: $GEMINI_API_KEY
  - title: Grok
    provider: xai
    model: grok-beta
    apiKey: $XAI_API_KEY
# Tools, knowledge, etc.
```
Set env API keys.

### Production Build
- Extensions: `npm run package`.
- Binary: `cd binary && npm run build`.

## Usage

### VS Code
- Open: Ctrl+Shift+P > \"TA+3 NewCoder: Open\".
- Chat: Cmd/Ctrl+L focus; slash /onboard.
- Autocomplete: Toggle Cmd/Ctrl+K Cmd+A.
- Edit: Select, Cmd/Ctrl+I for edits.
- RAG: Ask in chat about code/docs.

### Configuration
Edit config.yaml:
- Models with API keys.
- Enable tools/knowledge.
- Profiles for setups.
Auto-refresh hourly.

Examples:
- \"Write React login component\".
- Highlight code: \"Fix bug\".
- \"Project architecture summary\".

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

- Tests: `npm test`.
- Lint: `npm run lint`.
- Format: `npm run format`.
- PRs: From main, describe, pass CI.

Issues: [GitHub](.github/ISSUE_TEMPLATE).

## License

[Apache 2.0 © 2023-2024 Continue Dev, Inc.](LICENSE)

[Apache 2.0 © 2024-2025 TA+3 SOFT, Inc.](LICENSE)