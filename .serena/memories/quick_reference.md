# YinHai Continue 快速参考

## 常用路径

### 核心文件
- **Core 主类**: `/core/core.ts` (1,360 行)
- **VS Code 扩展入口**: `/extensions/vscode/src/extension.ts`
- **React 应用根**: `/gui/src/App.tsx`
- **CLI 入口**: `/binary/src/index.ts`

### 配置文件
- **Root package.json**: `/package.json`
- **Core package.json**: `/core/package.json`
- **GUI package.json**: `/gui/package.json`
- **VS Code manifest**: `/extensions/vscode/package.json`
- **TypeScript 配置**: `/tsconfig.json` (root), `/core/tsconfig.json`, `/gui/tsconfig.json`

### 关键模块目录
- **LLM 提供商**: `/core/llm/llms/`
- **自动补全**: `/core/autocomplete/`
- **代码索引**: `/core/indexing/`
- **上下文系统**: `/core/context/providers/`
- **工具系统**: `/core/tools/definitions/`
- **协议定义**: `/core/protocol/`
- **配置系统**: `/core/config/`

## 常用命令

### 开发
```bash
# 安装所有依赖
npm install

# 编译 watch 模式
npm run tsc:watch

# GUI 开发服务器
cd gui && npm run dev

# VS Code 扩展 watch
cd extensions/vscode && npm run watch
```

### 构建
```bash
# VS Code 扩展打包
cd extensions/vscode && npm run package

# IntelliJ 插件构建
cd extensions/intellij && ./gradlew build

# 二进制构建
cd binary && npm run build

# GUI 生产构建
cd gui && npm run build
```

### Git
```bash
# 当前分支
git branch  # yinhai_dev

# 检查状态
git status

# 查看最近提交
git log --oneline -5
```

## 技术栈快速查看

### 核心技术
- **语言**: TypeScript 5.6+
- **运行时**: Node.js >= 20.19.0
- **前端**: React 18.2 + Redux Toolkit
- **构建**: esbuild, Vite 6.3
- **测试**: Jest 29.7, Vitest 3.1

### 主要依赖
- socket.io-client 4.7.3
- @lancedb/vectordb 0.4.20
- web-tree-sitter 0.21.0
- @xenova/transformers 2.14.0
- openai 4.76.0
- tailwindcss 3.2.7

## 架构快速图

```
┌─────────────────┐
│  VS Code/IntelliJ │
└────────┬────────┘
         │ IPC/TCP
┌────────▼────────┐
│   Core (Node)   │ ← 主要逻辑层
│  • LLM (60提供商)│
│  • 索引 (向量+全文)│
│  • 工具 (25+)    │
└────────┬────────┘
         │
┌────────▼────────┐
│   外部服务      │
│  • OpenAI/Claude │
│  • LanceDB      │
└─────────────────┘
```

## 模块职责快速索引

| 模块 | 职责 | 关键文件 |
|------|------|----------|
| **core** | 主要业务逻辑 | `core.ts` |
| **llm** | LLM 集成 | `llm/index.ts` |
| **autocomplete** | 代码补全 | `autocomplete/CompletionProvider.ts` |
| **indexing** | 代码库索引 | `indexing/CodebaseIndexer.ts` |
| **context** | 上下文检索 | `context/providers/` |
| **tools** | 工具执行 | `tools/callTool.ts` |
| **config** | 配置管理 | `config/ConfigHandler.ts` |
| **protocol** | IPC 通信 | `protocol/core.ts` |

## 开发工作流快速指南

1. **启动开发环境**:
   ```bash
   npm run tsc:watch     # Terminal 1: 编译 watch
   cd gui && npm run dev # Terminal 2: GUI dev server
   ```

2. **调试 VS Code 扩展**:
   ```bash
   cd extensions/vscode && npm run watch  # Terminal 1
   # 在 VS Code 中按 F5 启动调试实例
   ```

3. **运行测试**:
   ```bash
   npm test              # 运行所有测试
   cd core && npm test   # 运行 Core 测试
   cd gui && npm test    # 运行 GUI 测试
   ```

4. **构建生产版本**:
   ```bash
   npm run package       # 打包所有
   ```

## 常见任务

### 添加新的 LLM 提供商
1. 在 `/core/llm/llms/` 创建新文件
2. 实现 `ILLM` 接口
3. 在 `/core/llm/llms/index.ts` 注册
4. 在 config 类型中添加配置定义

### 添加新的上下文提供者
1. 在 `/core/context/providers/` 创建新类
2. 实现 `IContextProvider` 接口
3. 在提供者注册表中注册

### 添加新工具
1. 在 `/core/tools/definitions/` 定义工具 schema
2. 在 `/core/tools/implementations/` 实现工具逻辑
3. 在 `/core/tools/builtIn.ts` 注册

### 修改 GUI 界面
1. 组件位置: `/gui/src/components/`
2. Redux slices: `/gui/src/redux/slices/`
3. 样式: Tailwind CSS classes

## 调试技巧

### 查看 Core 日志
- 日志位置: `~/.continue/logs/`
- 启用详细日志: 设置环境变量 `DEBUG=*`

### 查看 LLM 调用
- LLM 日志: `/core/llm/logFormatter.ts`
- 检查 token 计数: `/core/llm/countTokens.ts`

### 调试索引问题
- 索引数据: `~/.continue/index/`
- 手动触发重新索引: 在 IDE 中执行 "Continue: Refresh Index" 命令

## 环境变量

```bash
# LLM API Keys
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_API_KEY=

# Continue 配置
CONTINUE_CONFIG_PATH=~/.continue/config.yaml

# 调试
DEBUG=*                    # 启用所有调试日志
NODE_ENV=development       # 开发模式
```

## 端口和服务

- **GUI Dev Server**: http://localhost:5173 (Vite)
- **Core IPC**: Unix socket / TCP (配置决定)
- **WebSocket**: 随机端口（Socket.io）