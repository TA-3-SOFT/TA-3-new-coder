# YinHai Continue 开发指南

## 快速开始

### 1. 环境准备

**系统要求**:
- **Node.js**: >= 20.19.0
- **npm**: >= 10.x
- **Git**: 最新版本
- **IDE**: VS Code 或 IntelliJ IDEA

**可选工具**:
- Docker (用于本地 LLM)
- Ollama (本地 LLM 运行)

### 2. 克隆和安装

```bash
# 克隆仓库
git clone <repository-url>
cd yinhai-continue

# 安装依赖
npm install

# 验证安装
node --version    # 应该 >= 20.19.0
npm --version     # 应该 >= 10.x
```

### 3. 开发环境设置

```bash
# Terminal 1: 编译 TypeScript (watch 模式)
npm run tsc:watch

# Terminal 2: GUI 开发服务器
cd gui
npm run dev

# Terminal 3: VS Code 扩展 watch
cd extensions/vscode
npm run watch
```

### 4. 调试 VS Code 扩展

1. 在 VS Code 中打开项目
2. 按 `F5` 或点击 "Run and Debug" → "Extension"
3. 新窗口将打开，加载开发中的扩展
4. 设置断点并测试

---

## 项目结构导航

### 添加新功能的位置

| 功能类型 | 目录 | 示例文件 |
|----------|------|----------|
| **LLM 提供商** | `/core/llm/llms/` | `OpenAI.ts`, `Anthropic.ts` |
| **上下文提供者** | `/core/context/providers/` | `CodebaseContextProvider.ts` |
| **工具** | `/core/tools/definitions/` | `terminal/`, `project-memory/` |
| **GUI 组件** | `/gui/src/components/` | `ChatMessage.tsx` |
| **Redux Slice** | `/gui/src/redux/slices/` | `chatSlice.ts` |
| **VS Code 命令** | `/extensions/vscode/src/commands/` | `quickEdit.ts` |
| **协议定义** | `/core/protocol/` | `core.ts`, `ide.ts` |

---

## 开发工作流

### 1. 添加新的 LLM 提供商

**步骤**:

1. **创建提供商类**:
   ```typescript
   // /core/llm/llms/MyNewProvider.ts
   import { BaseLLM } from "./BaseLLM";
   
   export class MyNewProvider extends BaseLLM {
     async *streamChat(messages, options) {
       // 实现流式聊天
     }
     
     async *streamComplete(prompt, options) {
       // 实现流式补全
     }
   }
   ```

2. **注册提供商**:
   ```typescript
   // /core/llm/llms/index.ts
   import { MyNewProvider } from "./MyNewProvider";
   
   export const LLM_PROVIDERS = {
     // ... 其他提供商
     "mynewprovider": MyNewProvider,
   };
   ```

3. **添加类型定义**:
   ```typescript
   // /core/config/types.ts
   export interface MyNewProviderOptions extends BaseProviderOptions {
     apiKey: string;
     customParam?: string;
   }
   ```

4. **更新配置 Schema**:
   ```typescript
   // /core/config/yaml/index.ts
   // 添加 Zod schema 验证
   ```

5. **测试**:
   ```bash
   cd core
   npm test -- llm/llms/MyNewProvider.test.ts
   ```

### 2. 添加新的上下文提供者

**步骤**:

1. **创建提供者类**:
   ```typescript
   // /core/context/providers/MyContextProvider.ts
   import { BaseContextProvider } from "./BaseContextProvider";
   
   export class MyContextProvider extends BaseContextProvider {
     static description = "My custom context provider";
     
     async getContextItems(query, extras) {
       // 实现上下文检索逻辑
       return [{
         name: "Context Item",
         description: "Description",
         content: "Content here",
       }];
     }
   }
   ```

2. **注册提供者**:
   ```typescript
   // /core/context/providers/index.ts
   import { MyContextProvider } from "./MyContextProvider";
   
   export const CONTEXT_PROVIDERS = {
     // ... 其他提供者
     "my-context": MyContextProvider,
   };
   ```

3. **配置使用**:
   ```yaml
   # ~/.continue/config.yaml
   contexts:
     - name: my-custom-context
       provider: my-context
       params:
         key: value
   ```

### 3. 添加新工具

**步骤**:

1. **定义工具 Schema**:
   ```typescript
   // /core/tools/definitions/my-tool/schema.ts
   export const myToolSchema = {
     name: "my_tool",
     description: "Description of what the tool does",
     parameters: {
       type: "object",
       properties: {
         param1: {
           type: "string",
           description: "Parameter description",
         },
       },
       required: ["param1"],
     },
   };
   ```

2. **实现工具逻辑**:
   ```typescript
   // /core/tools/implementations/myTool.ts
   export async function myToolImplementation(params, extras) {
     // 实现工具逻辑
     const { param1 } = params;
     
     // 执行操作
     const result = await doSomething(param1);
     
     return {
       output: result,
       success: true,
     };
   }
   ```

3. **注册工具**:
   ```typescript
   // /core/tools/builtIn.ts
   import { myToolSchema } from "./definitions/my-tool/schema";
   import { myToolImplementation } from "./implementations/myTool";
   
   export const BUILTIN_TOOLS = [
     // ... 其他工具
     {
       schema: myToolSchema,
       implementation: myToolImplementation,
     },
   ];
   ```

### 4. 添加 GUI 组件

**步骤**:

1. **创建 React 组件**:
   ```typescript
   // /gui/src/components/MyComponent.tsx
   import React from "react";
   
   interface MyComponentProps {
     data: string;
   }
   
   export const MyComponent: React.FC<MyComponentProps> = ({ data }) => {
     return (
       <div className="flex flex-col gap-2">
         <h2 className="text-lg font-bold">{data}</h2>
       </div>
     );
   };
   ```

2. **添加到页面**:
   ```typescript
   // /gui/src/views/MyView.tsx
   import { MyComponent } from "../components/MyComponent";
   
   export const MyView = () => {
     return (
       <div>
         <MyComponent data="Hello" />
       </div>
     );
   };
   ```

3. **连接 Redux**:
   ```typescript
   // /gui/src/redux/slices/mySlice.ts
   import { createSlice } from "@reduxjs/toolkit";
   
   const mySlice = createSlice({
     name: "my",
     initialState: { data: "" },
     reducers: {
       setData: (state, action) => {
         state.data = action.payload;
       },
     },
   });
   
   export const { setData } = mySlice.actions;
   export default mySlice.reducer;
   ```

### 5. 添加 VS Code 命令

**步骤**:

1. **定义命令**:
   ```typescript
   // /extensions/vscode/src/commands/myCommand.ts
   import * as vscode from "vscode";
   
   export async function myCommand(ide: VsCodeIde) {
     // 获取当前编辑器
     const editor = vscode.window.activeTextEditor;
     if (!editor) return;
     
     // 执行操作
     const selection = editor.selection;
     const text = editor.document.getText(selection);
     
     // 调用 Core
     const result = await ide.invoke("my/action", { text });
     
     // 显示结果
     vscode.window.showInformationMessage(result);
   }
   ```

2. **注册命令**:
   ```typescript
   // /extensions/vscode/src/commands.ts
   import { myCommand } from "./commands/myCommand";
   
   export function registerCommands(context, ide) {
     context.subscriptions.push(
       vscode.commands.registerCommand(
         "continue.myCommand",
         () => myCommand(ide)
       )
     );
   }
   ```

3. **添加到 package.json**:
   ```json
   // /extensions/vscode/package.json
   {
     "contributes": {
       "commands": [
         {
           "command": "continue.myCommand",
           "title": "Continue: My Command",
           "category": "Continue"
         }
       ]
     }
   }
   ```

---

## 测试

### 单元测试

**Core 模块测试 (Jest)**:
```bash
cd core
npm test                          # 运行所有测试
npm test -- llm/llms/OpenAI.test.ts  # 运行特定测试
npm test -- --watch              # Watch 模式
```

**GUI 组件测试 (Vitest)**:
```bash
cd gui
npm test                         # 运行所有测试
npm test -- MyComponent.test.tsx # 运行特定测试
npm test -- --ui                 # UI 模式
```

### 编写测试

**Core 测试示例**:
```typescript
// /core/llm/llms/OpenAI.test.ts
import { OpenAI } from "./OpenAI";

describe("OpenAI Provider", () => {
  it("should stream chat responses", async () => {
    const provider = new OpenAI({
      apiKey: "test-key",
      model: "gpt-4",
    });
    
    const messages = [{ role: "user", content: "Hello" }];
    const stream = provider.streamChat(messages);
    
    let result = "";
    for await (const chunk of stream) {
      result += chunk.content;
    }
    
    expect(result).toBeTruthy();
  });
});
```

**GUI 测试示例**:
```typescript
// /gui/src/components/MyComponent.test.tsx
import { render, screen } from "@testing-library/react";
import { MyComponent } from "./MyComponent";

describe("MyComponent", () => {
  it("should render data", () => {
    render(<MyComponent data="Test" />);
    expect(screen.getByText("Test")).toBeInTheDocument();
  });
});
```

---

## 调试技巧

### 1. Core 调试

**启用详细日志**:
```bash
# 设置环境变量
export DEBUG=*
export NODE_ENV=development

# 运行 Core
cd core
npm run dev
```

**日志位置**:
- `~/.continue/logs/core.log`
- `~/.continue/logs/llm.log`

**使用 Node.js Inspector**:
```bash
node --inspect-brk core/out/index.js
# 在 Chrome 中打开 chrome://inspect
```

### 2. GUI 调试

**React DevTools**:
- 安装 React DevTools 浏览器扩展
- 在 Dev Server (http://localhost:5173) 中使用

**Redux DevTools**:
- 安装 Redux DevTools 扩展
- 查看 state 变化和 actions

**Console Debugging**:
```typescript
// 在组件中
console.log("Debug:", data);
```

### 3. VS Code 扩展调试

**Launch Configuration**:
```json
// .vscode/launch.json (已配置)
{
  "type": "extensionHost",
  "request": "launch",
  "name": "Extension",
  "runtimeExecutable": "${execPath}",
  "args": ["--extensionDevelopmentPath=${workspaceFolder}/extensions/vscode"]
}
```

**调试步骤**:
1. 在代码中设置断点
2. 按 F5 启动调试
3. 在新窗口中触发功能
4. 断点将被命中

---

## 常见问题

### 1. 编译错误

**问题**: TypeScript 编译失败
```bash
# 清理 node_modules 并重新安装
rm -rf node_modules package-lock.json
npm install

# 清理 TypeScript 缓存
rm -rf */*/tsconfig.tsbuildinfo
npm run tsc:clean
```

### 2. GUI 不加载

**问题**: Vite dev server 无法启动
```bash
# 检查端口占用
lsof -i :5173

# 清理 Vite 缓存
cd gui
rm -rf node_modules/.vite
npm run dev
```

### 3. VS Code 扩展无法加载

**问题**: 扩展在调试时不工作
```bash
# 重新编译扩展
cd extensions/vscode
npm run compile

# 检查 Core 是否运行
ps aux | grep "continue"
```

### 4. LLM API 调用失败

**问题**: API key 未设置或无效
```bash
# 检查配置
cat ~/.continue/config.yaml

# 设置环境变量
export OPENAI_API_KEY=your-key-here
export ANTHROPIC_API_KEY=your-key-here
```

---

## 代码规范

### TypeScript 规范

```typescript
// ✅ 好的实践
interface User {
  id: string;
  name: string;
}

async function getUser(id: string): Promise<User> {
  // 实现
}

// ❌ 避免
function getUser(id: any): any {
  // 没有类型
}
```

### React 规范

```typescript
// ✅ 好的实践
export const MyComponent: React.FC<Props> = ({ data }) => {
  const [state, setState] = useState<string>("");
  
  useEffect(() => {
    // Side effects
  }, [dependencies]);
  
  return <div>{data}</div>;
};

// ❌ 避免
export default function MyComponent(props) {
  // 没有类型，使用 default export
}
```

### 命名规范

- **文件**: camelCase (`myFile.ts`)
- **类**: PascalCase (`MyClass`)
- **函数**: camelCase (`myFunction`)
- **常量**: UPPER_SNAKE_CASE (`MY_CONSTANT`)
- **接口**: PascalCase (`IMyInterface` 或 `MyInterface`)
- **类型**: PascalCase (`MyType`)

---

## Git 工作流

### 分支策略

```bash
# 创建功能分支
git checkout -b feature/my-feature

# 提交更改
git add .
git commit -m "feat: add my feature"

# 推送到远程
git push origin feature/my-feature

# 创建 Pull Request
```

### Commit 规范

使用 Conventional Commits:
```
feat: 新功能
fix: 修复 bug
docs: 文档更新
style: 代码格式（不影响逻辑）
refactor: 重构
test: 测试相关
chore: 构建/工具相关
```

示例:
```bash
git commit -m "feat: add support for new LLM provider"
git commit -m "fix: resolve autocomplete crash on empty file"
git commit -m "docs: update installation guide"
```

---

## 发布流程

### 1. 版本更新

```bash
# 更新版本号
npm version patch  # 1.0.0 -> 1.0.1
npm version minor  # 1.0.0 -> 1.1.0
npm version major  # 1.0.0 -> 2.0.0
```

### 2. 构建所有组件

```bash
# VS Code 扩展
cd extensions/vscode
npm run package  # 生成 .vsix

# IntelliJ 插件
cd extensions/intellij
./gradlew build  # 生成 .jar

# 二进制
cd binary
npm run build    # 生成可执行文件
```

### 3. 测试

```bash
# 运行所有测试
npm test

# 手动测试各个组件
```

### 4. 发布

```bash
# 推送 tag
git tag v1.0.0
git push origin v1.0.0

# 创建 GitHub Release
# 上传构建产物
```

---

## 性能优化技巧

### 1. Core 性能

- **缓存**: 使用 LRU 缓存频繁访问的数据
- **流式处理**: 避免一次性加载大量数据
- **并行处理**: 使用 Worker Threads 处理耗时操作
- **延迟加载**: 按需导入大型模块

### 2. GUI 性能

- **React.memo**: 缓存不变的组件
- **useMemo/useCallback**: 避免不必要的重新计算
- **虚拟滚动**: 处理大列表
- **代码分割**: React.lazy + Suspense

### 3. 索引性能

- **增量索引**: 只索引变更的文件
- **后台处理**: 使用 Worker 避免阻塞主线程
- **批量操作**: 批量写入数据库

---

## 有用的资源

### 文档
- Continue.dev 官方文档: https://docs.continue.dev
- TypeScript 文档: https://www.typescriptlang.org/docs
- React 文档: https://react.dev
- Vite 文档: https://vitejs.dev

### 工具
- VS Code API: https://code.visualstudio.com/api
- LanceDB: https://lancedb.github.io/lancedb
- Tree-sitter: https://tree-sitter.github.io/tree-sitter

---

## 贡献指南

### 1. Fork 项目
### 2. 创建功能分支
### 3. 编写代码和测试
### 4. 提交 Pull Request
### 5. 等待 Code Review

---

**最后更新**: 2025-10-29  
**维护者**: YinHai Team