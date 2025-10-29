# IntelliJ IDEA Plugin 架构文档

**插件名称**: TA+3 New Coder IntelliJ Plugin  
**插件ID**: com.yinhai.TA3AiPlugin  
**版本**: 1.0.33-beta  
**主要语言**: Kotlin + Java  
**构建系统**: Gradle 8.3 + Kotlin DSL

---

## 1. 插件概览

### 核心定位
TA+3 New Coder IntelliJ 插件是 YinHai Continue 项目的 JetBrains IDE 扩展，为 IntelliJ IDEA 和其他 JetBrains IDE 提供 AI 代码辅助功能。

### 主要特性
- **智能代码补全**: Tab 自动补全，支持部分接受
- **聊天式辅助**: 基于 Webview 的 GUI 聊天界面
- **内联编辑**: Ctrl+I/Cmd+I 触发内联代码编辑
- **代码透镜**: Java、TypeScript、Python、Kotlin、PHP、Rust 代码提示
- **差异流**: 实时代码差异预览与接受/拒绝
- **Git 集成**: 自动生成 Commit 消息
- **认证系统**: Control Plane 认证支持
- **调试过滤器**: AI 驱动的调试器堆栈过滤

---

## 2. 技术栈

### 构建配置

#### Gradle 配置 (build.gradle.kts)
```kotlin
plugins:
  - java
  - kotlin (1.8.0)
  - gradleIntelliJPlugin (Gradle IntelliJ Plugin)
  - changelog (Changelog Plugin)
  - qodana (Code Quality)
  - kover (Code Coverage)
  - kotlin-serialization
```

#### Platform 配置 (gradle.properties)
| 配置项 | 值 | 说明 |
|--------|-----|------|
| pluginGroup | com.yinhai.TA3AiPlugin | 插件组 |
| pluginName | TA+3 New Coder | 插件名称 |
| pluginVersion | 1.0.33-beta | 当前版本 |
| pluginSinceBuild | 223 | 最低支持构建 (2022.3+) |
| platformType | IC | IntelliJ Community Edition |
| platformVersion | 2022.3.3 | 目标平台版本 |
| gradleVersion | 8.3 | Gradle 版本 |
| jvmToolchain | 17 | JVM 版本 |

#### Platform 依赖插件
- org.jetbrains.plugins.terminal
- Git4Idea
- java

### 核心依赖

#### HTTP 和网络
- **okhttp**: 4.12.0 - HTTP 客户端，与 Core 通信

#### 序列化和数据
- **kotlinx-serialization-json**: 1.5.0 - JSON 序列化

#### 分析和遥测
- **posthog**: 1.+ - 产品分析和用户行为跟踪

#### 日志
- **log4j-core**: 2.20.0
- **log4j-api**: 2.20.0
- **log4j-slf4j-impl**: 2.20.0

#### 测试
- **remote-robot**: 0.11.23 - UI 测试框架
- **mockk**: 1.14.2 - Kotlin 测试框架
- **junit-jupiter**: 5.10.0
- **kotlinx-coroutines-test**: 1.7.3

---

## 3. 插件架构

### 3.1 目录结构

```
extensions/intellij/
├── build.gradle.kts              # Gradle 构建脚本
├── gradle.properties             # 插件配置
├── settings.gradle.kts           # Gradle 设置
├── .run/                         # IntelliJ 运行配置
│   ├── Run Continue.run.xml
│   ├── Start Core Dev Server.run.xml
│   └── Run Tests.run.xml
├── src/
│   ├── main/
│   │   ├── kotlin/               # Kotlin 源代码
│   │   │   └── com/github/continuedev/continueintellijextension/
│   │   │       ├── activities/   # 启动活动
│   │   │       ├── actions/      # IDE 动作
│   │   │       ├── autocomplete/ # 自动补全
│   │   │       ├── auth/         # 认证系统
│   │   │       ├── continue/     # 核心逻辑
│   │   │       ├── editor/       # 编辑器集成
│   │   │       ├── factories/    # 工厂类
│   │   │       ├── lens/         # Code Lens 提供者
│   │   │       ├── listeners/    # 事件监听器
│   │   │       ├── protocol/     # 协议定义
│   │   │       ├── services/     # 插件服务
│   │   │       ├── toolWindow/   # 工具窗口
│   │   │       └── utils/        # 工具类
│   │   ├── java/                 # Java 源代码
│   │   │   └── com/github/continuedev/continueintellijextension/
│   │   │       ├── actions/      # Java 动作
│   │   │       ├── filter/       # 调试过滤器
│   │   │       ├── model/        # 数据模型
│   │   │       └── utils/        # Java 工具类
│   │   └── resources/
│   │       ├── META-INF/
│   │       │   └── plugin.xml    # 插件配置清单
│   │       ├── icons/            # 图标资源
│   │       ├── webview/          # Webview HTML
│   │       ├── messages/         # i18n 资源
│   │       └── continue_tutorial.* # 教程文件
│   └── test/
│       └── kotlin/               # 测试代码
│           └── com/github/continuedev/continueintellijextension/
│               ├── unit/         # 单元测试
│               ├── e2e/          # E2E 测试
│               ├── fixtures/     # 测试 Fixtures
│               └── utils/        # 测试工具
└── build/                        # 构建输出
```

### 3.2 核心组件

#### Activities (启动活动)

**ContinuePluginStartupActivity.kt**
- 插件启动入口点
- 初始化插件服务
- 注册快捷键 (移除冲突的默认快捷键)
- 显示欢迎教程
- 设置文件监听器
- 初始化认证系统

#### Services (插件服务)

**ContinuePluginService.kt**
- 主要插件服务，管理插件生命周期
- 管理 `CoreMessengerManager`
- 管理 `IdeProtocolClient`
- 管理 `DiffStreamService`
- 维护工作区路径
- 与 Continue Webview 窗口交互

**DiffStreamService.kt**
- 管理代码差异流
- 处理实时代码编辑预览
- 提供差异接受/拒绝功能

**AutocompleteService.kt**
- 管理自动补全功能
- 与 Core 通信获取补全建议
- 处理补全渲染和接受

**ContinueExtensionSettings.kt**
- 插件设置管理
- 配置项存储和加载
- 设置变更监听

**TelemetryService.kt**
- 用户行为跟踪
- PostHog 集成
- 遥测数据收集

#### Core Communication (核心通信)

**CoreMessenger.kt**
- 与 Node.js Core 进程的 IPC 通信
- 使用标准输入/输出流 (stdin/stdout)
- JSON-RPC 风格的消息传递
- 请求/响应模式

**CoreMessengerManager.kt**
- 管理 Core 进程生命周期
- 启动/重启 Core 进程
- 处理进程异常
- 管理多个 CoreMessenger 实例

**IdeProtocolClient.kt**
- 实现 IDE → Core 协议
- 处理 Core 的请求和回调
- 提供 IDE 功能给 Core (文件操作、编辑器状态等)

**IntelliJIDE.kt**
- IntelliJ 平台抽象层
- 提供 IDE 特定功能的实现
- 文件系统操作
- 编辑器操作
- Git 操作
- 工作区管理

#### Autocomplete (自动补全)

**AutocompleteEditorListener.kt**
- 监听编辑器事件
- 触发自动补全请求
- 管理补全生命周期

**ContinueInlayRenderer.kt**
- 渲染内联补全建议
- 提供视觉反馈
- 处理补全的接受和拒绝

**AcceptAutocompleteAction.kt**
- Tab 键接受补全

**PartialAcceptAutocompleteAction.kt**
- Ctrl+Alt+Right / Cmd+Option+Right 部分接受

**CancelAutocompleteAction.kt**
- ESC 取消补全

**AutocompleteLookupListener.kt**
- 监听 IDE 原生补全弹窗
- 处理补全冲突

**AutocompleteSpinnerWidgetFactory.kt**
- 状态栏加载指示器
- 显示补全请求状态

#### Editor Integration (编辑器集成)

**InlineEditAction.kt**
- Ctrl+I / Cmd+I 触发内联编辑
- 启动编辑流程
- 显示编辑面板

**InlineEditPanel.kt**
- 内联编辑输入面板
- 用户输入收集
- 提交编辑请求

**DiffStreamHandler.kt**
- 处理流式差异数据
- 解析和应用代码变更
- 管理差异块

**VerticalDiffBlock.kt**
- 垂直差异块可视化
- 差异预览组件
- 接受/拒绝 UI

**EditorComponentInlaysManager.kt**
- 管理编辑器内嵌组件
- 插入和移除差异块
- 编辑器装饰

**ContinueEditorLinePainter.kt**
- 编辑器行高亮
- 视觉反馈

#### Tool Window (工具窗口)

**ContinuePluginToolWindowFactory.kt**
- 创建右侧 "TA+3 牛码" 工具窗口
- 管理工具窗口生命周期

**ContinueBrowser.kt**
- 嵌入式 JCEF 浏览器
- 加载 React GUI (webview)
- JavaScript ↔ Kotlin 桥接
- 处理 GUI 消息

#### Actions (快捷操作)

**ContinuePluginActions.kt**
- 定义所有插件动作

**快捷键映射**:
| 动作 | Windows/Linux | macOS | 功能 |
|------|--------------|-------|------|
| Inline Edit | Ctrl+I | Cmd+I | 内联编辑 |
| Focus Input | Ctrl+J | Cmd+J | 聚焦输入框 (清空聊天) |
| Focus Input (Keep) | Ctrl+Shift+J | Cmd+Shift+J | 聚焦输入框 (保留上下文) |
| Accept Diff | Ctrl+Shift+Enter | Cmd+Shift+Enter | 接受差异 |
| Reject Diff | Ctrl+Shift+Backspace | Cmd+Shift+Backspace | 拒绝差异 |
| Accept Vertical Block | Alt+Shift+Y | Alt+Shift+Y | 接受垂直块 |
| Reject Vertical Block | Alt+Shift+N | Alt+Shift+N | 拒绝垂直块 |
| Accept Autocomplete | Tab | Tab | 接受补全 |
| Partial Accept | Ctrl+Alt+Right | Cmd+Option+Right | 部分接受 |
| Cancel Autocomplete | ESC | ESC | 取消补全 |

**其他动作**:
- NewContinueSessionAction: 新建会话
- ViewHistoryAction: 查看历史会话
- OpenConfigAction: 打开配置
- OpenLogsAction: 打开日志
- SetTopRightAnchorAction: 工具窗口位置 (右侧)
- SetBottomLeftAnchorAction: 工具窗口位置 (底部)
- CommitMessageGenerationAction: 生成 Commit 消息

#### Code Lens (代码透镜)

**支持语言**:
- Java: TabnineLensJavaProvider
- TypeScript: TabnineLensTypescriptProvider
- Python: TabnineLensPythonProvider
- Kotlin: TabnineLensKotlinProvider
- PHP: TabnineLensPhpProvider
- Rust: TabnineLensRustProvider

**功能**:
- 代码内联提示
- 快速操作入口
- 上下文菜单集成

#### Authentication (认证)

**ContinueAuthService.kt**
- 管理用户认证
- Control Plane 集成
- Token 管理

**ContinueAuthDialog.kt**
- 认证对话框
- 登录/登出 UI

**AuthListener.kt**
- 认证状态变更监听
- 自动刷新 Token

#### Listeners (事件监听器)

**ContinuePluginSelectionListener.kt**
- 监听编辑器文本选择
- 发送选择变更到 Core

**VirtualFileListener.kt**
- 监听文件系统变更
- 文件创建/删除/修改事件
- 通知 Core 更新索引

**AsyncFileSaveListener.kt**
- 异步文件保存监听
- 触发索引更新

#### Utilities (工具类)

**UriUtils.kt**
- URI 和文件路径转换
- 跨平台路径处理

**Paths.kt**
- 路径工具函数
- 工作区路径管理

**Utils.kt**
- 通用工具函数

**Debouncer.kt**
- 事件防抖
- 减少频繁触发

**LocalHistoryUtil.kt**
- 本地历史管理
- 代码回滚支持

**GitService.kt**
- Git 操作封装
- 分支、提交、Diff 查询

#### Debugger Filter (调试过滤器)

**TaAiDebuggerFilter.java**
- 调试堆栈过滤
- AI 驱动的异常分析
- 智能堆栈简化

**TaAiPresentation.java**
- 调试信息展示
- 自定义调试视图

---

## 4. 插件配置清单 (plugin.xml)

### Extension Points (扩展点)

```xml
<extensions defaultExtensionNs="com.intellij">
  <!-- 编辑器监听器 -->
  <editorFactoryListener implementation="...AutocompleteEditorListener"/>
  
  <!-- 工具窗口 -->
  <toolWindow id="TA+3 牛码" anchor="right" icon="/tool-window-icon.svg"
              factoryClass="...ContinuePluginToolWindowFactory"/>
  
  <!-- 项目服务 -->
  <projectService serviceImplementation="...ContinuePluginService"/>
  <projectService serviceImplementation="...DiffStreamService"/>
  <projectService serviceImplementation="...AutocompleteLookupListener"/>
  
  <!-- 状态栏组件 -->
  <statusBarWidgetFactory implementation="...AutocompleteSpinnerWidgetFactory"/>
  
  <!-- 通知组 -->
  <notificationGroup id="Continue" displayType="BALLOON"/>
  
  <!-- 启动活动 -->
  <postStartupActivity implementation="...ContinuePluginStartupActivity"/>
  
  <!-- 应用级配置 -->
  <applicationConfigurable parentId="tools"
                          instance="...ContinueExtensionConfigurable"
                          displayName="TA+3 牛码"/>
  
  <!-- 应用级服务 -->
  <applicationService serviceImplementation="...ContinueExtensionSettings"/>
  
  <!-- Code Lens 提供者 -->
  <codeInsight.inlayProvider language="JAVA" implementationClass="...TabnineLensJavaProvider"/>
  <codeInsight.inlayProvider language="TypeScript" implementationClass="...TabnineLensTypescriptProvider"/>
  <codeInsight.inlayProvider language="Python" implementationClass="...TabnineLensPythonProvider"/>
  <codeInsight.inlayProvider language="kotlin" implementationClass="...TabnineLensKotlinProvider"/>
  <codeInsight.inlayProvider language="PHP" implementationClass="...TabnineLensPhpProvider"/>
  <codeInsight.inlayProvider language="Rust" implementationClass="...TabnineLensRustProvider"/>
  
  <!-- 调试器过滤器 -->
  <jvm.exceptionFilter implementation="...TaAiDebuggerFilter"/>
</extensions>
```

### Dependencies (依赖)

```xml
<depends>com.intellij.modules.platform</depends>
<depends optional="true" config-file="continueintellijextension-withJSON.xml">
  com.intellij.modules.json
</depends>
<depends optional="true">Git4Idea</depends>
<depends optional="true" config-file="java-plugin.xml">com.intellij.java</depends>
```

### Compatibility (兼容性)

```xml
<idea-version since-build="223.7571.182"/>
```

支持 IntelliJ IDEA 2022.3+ 及所有 JetBrains IDE

---

## 5. 数据流和工作流程

### 5.1 插件启动流程

```
1. IntelliJ IDEA 加载插件
   ↓
2. ContinuePluginStartupActivity.runActivity()
   ↓
3. 移除冲突的快捷键
   ↓
4. 初始化插件
   ↓
5. ContinuePluginService 创建
   ├─ CoreMessengerManager 启动
   │  └─ 启动 Node.js Core 进程
   ├─ IdeProtocolClient 初始化
   ├─ DiffStreamService 初始化
   └─ 注册事件监听器
   ↓
6. ContinuePluginToolWindowFactory 创建工具窗口
   └─ ContinueBrowser (JCEF) 加载 React GUI
   ↓
7. 注册 Actions、Listeners、Services
   ↓
8. 显示教程 (首次启动)
```

### 5.2 聊天工作流

```
1. 用户在 GUI 输入消息
   ↓
2. ContinueBrowser JS Bridge 发送消息到 Kotlin
   ↓
3. IdeProtocolClient 转发到 CoreMessenger
   ↓
4. CoreMessenger 通过 IPC 发送到 Node.js Core
   ↓
5. Core 处理消息 (检索上下文、调用 LLM)
   ↓
6. Core 流式返回响应
   ↓
7. CoreMessenger 接收流式响应
   ↓
8. IdeProtocolClient 转发到 ContinueBrowser
   ↓
9. GUI 显示流式响应
```

### 5.3 自动补全工作流

```
1. 用户输入代码
   ↓
2. AutocompleteEditorListener 检测输入事件
   ↓
3. 触发补全请求 (带防抖)
   ↓
4. AutocompleteService 发送请求到 Core
   ↓
5. Core 生成补全建议
   ↓
6. AutocompleteService 接收建议
   ↓
7. ContinueInlayRenderer 渲染内联建议
   ↓
8. 用户按 Tab 接受 / ESC 取消
   ↓
9. AcceptAutocompleteAction / CancelAutocompleteAction 处理
```

### 5.4 内联编辑工作流

```
1. 用户选择代码，按 Ctrl+I / Cmd+I
   ↓
2. InlineEditAction 触发
   ↓
3. InlineEditPanel 显示输入框
   ↓
4. 用户输入编辑指令
   ↓
5. 发送请求到 Core (选中代码 + 指令)
   ↓
6. Core 调用 LLM 生成代码差异
   ↓
7. DiffStreamHandler 接收流式差异
   ↓
8. VerticalDiffBlock 渲染差异预览
   ↓
9. 用户接受 (Ctrl+Shift+Enter) 或拒绝 (Ctrl+Shift+Backspace)
   ↓
10. 应用差异到文件 / 丢弃差异
```

### 5.5 Code Lens 工作流

```
1. 用户打开 Java/TypeScript/Python 等文件
   ↓
2. IntelliJ 请求 Inlay Hints
   ↓
3. TabnineLens*Provider 计算提示位置
   ↓
4. 渲染内联提示 (快速操作图标)
   ↓
5. 用户点击提示
   ↓
6. 触发相关 Action (如 focusContinueInput)
```

---

## 6. 通信协议

### 6.1 IPC 通信架构

```
IntelliJ Plugin (Kotlin)
         ↓↑ IPC (stdin/stdout)
Node.js Core Process
         ↓↑ WebSocket/IPC
React GUI (Webview - JCEF)
```

### 6.2 消息格式

**IDE → Core** (ToCoreProtocol):
```json
{
  "messageType": "llm/streamChat",
  "messageId": "uuid",
  "data": {
    "messages": [...],
    "completionOptions": {...}
  }
}
```

**Core → IDE** (ToIdeProtocol):
```json
{
  "messageType": "showSuggestion",
  "messageId": "uuid",
  "data": {
    "suggestion": "...",
    "range": {...}
  }
}
```

### 6.3 协议消息类型

定义在 `protocol/ide.kt` 和 `protocol/ideWebview.kt`:

**IDE Protocol**:
- showSuggestion
- highlightCode
- readFile
- editFile
- applyToFile
- showDiff
- getProblems
- subprocess
- getBranch
- getOpenFiles

**Webview Protocol**:
- configUpdate
- getDefaultModelTitle
- indexProgress
- addContextItem
- refreshSubmenuItems

---

## 7. 关键设计决策

### 7.1 Kotlin + Java 混合架构
- **Kotlin**: 现代语言特性、协程、简洁语法
- **Java**: 平台兼容性、部分遗留功能

### 7.2 JCEF Webview
- 使用 Chromium Embedded Framework
- 嵌入完整 React GUI
- JavaScript ↔ Kotlin 桥接
- 支持现代 Web 技术

### 7.3 IPC 进程通信
- 独立 Node.js Core 进程
- 标准输入/输出流通信
- 跨平台兼容
- 进程隔离和稳定性

### 7.4 Code Lens 集成
- 利用 IntelliJ Platform Inlay API
- 多语言支持
- 无侵入式提示

### 7.5 差异流处理
- 实时流式差异预览
- 垂直差异块可视化
- 接受/拒绝单个块或全部

---

## 8. 构建和开发

### 8.1 开发环境设置

```bash
# 1. 前置条件
Java 17+
IntelliJ IDEA 2022.3+

# 2. 克隆项目
cd extensions/intellij

# 3. 构建插件
./gradlew buildPlugin

# 4. 运行测试
./gradlew test

# 5. 启动调试 IDE
./gradlew runIde

# 6. 运行 UI 测试
./gradlew runIdeForUiTests
```

### 8.2 调试配置

**.run/Run Continue.run.xml**
- 启动沙箱 IDE
- 加载插件
- 调试模式

**.run/Start Core Dev Server.run.xml**
- 启动 Core 开发服务器
- 热重载支持

**.run/Run Tests.run.xml**
- 执行单元测试
- 生成测试报告

### 8.3 构建产物

```bash
# 构建 .jar 插件
./gradlew buildPlugin
# 输出: build/distributions/TA+3 New Coder-1.0.33-beta.jar

# 签名插件 (需要证书)
./gradlew signPlugin

# 发布插件
./gradlew publishPlugin
```

### 8.4 测试

**单元测试**:
- `src/test/kotlin/unit/`
- JUnit 5
- MockK

**E2E 测试**:
- `src/test/kotlin/e2e/`
- Remote Robot
- 自动化 UI 测试

**测试覆盖**:
- Kover 插件
- XML 报告生成

---

## 9. 关键文件快速索引

### 插件配置
| 文件 | 用途 |
|------|------|
| `build.gradle.kts` | Gradle 构建脚本 |
| `gradle.properties` | 插件版本和配置 |
| `src/main/resources/META-INF/plugin.xml` | 插件清单 |

### 核心类
| 文件 | 行数 | 用途 |
|------|------|------|
| `activities/ContinuePluginStartupActivity.kt` | ~300 | 启动活动 |
| `services/ContinuePluginService.kt` | ~200 | 主插件服务 |
| `continue/CoreMessenger.kt` | ~400 | IPC 通信 |
| `continue/IntelliJIDE.kt` | ~800 | IDE 抽象层 |
| `autocomplete/AutocompleteService.kt` | ~500 | 自动补全 |
| `editor/DiffStreamHandler.kt` | ~600 | 差异流处理 |
| `toolWindow/ContinueBrowser.kt` | ~400 | JCEF 浏览器 |

### 协议定义
| 文件 | 用途 |
|------|------|
| `protocol/ide.kt` | IDE 协议类型 |
| `protocol/ideWebview.kt` | Webview 协议类型 |

---

## 10. 与 VS Code 扩展的对比

| 特性 | IntelliJ Plugin | VS Code Extension |
|------|----------------|-------------------|
| **语言** | Kotlin + Java | TypeScript |
| **架构** | JetBrains Platform | VS Code Extension API |
| **Webview** | JCEF (Chromium) | VS Code Webview API |
| **通信** | IPC (stdin/stdout) | IPC (Node.js) |
| **构建** | Gradle | esbuild |
| **测试** | JUnit + Remote Robot | Jest |
| **自动补全** | Inlay Renderer | InlineCompletionProvider |
| **差异预览** | VerticalDiffBlock | Diff Editor |
| **Code Lens** | InlayProvider | CodeLens Provider |
| **打包** | .jar | .vsix |
| **分发** | JetBrains Marketplace | VS Code Marketplace |

### 共同点
- 都使用独立 Node.js Core 进程
- 都嵌入相同的 React GUI
- 都实现相同的 IPC 协议
- 都支持聊天、补全、编辑功能

### 差异点
- IntelliJ 使用 JCEF，VS Code 使用 Webview API
- IntelliJ 使用 Kotlin，VS Code 使用 TypeScript
- IntelliJ 支持多个 JetBrains IDE，VS Code 仅 VS Code

---

## 11. 性能优化

### 11.1 协程优化
- 使用 Kotlin 协程进行异步操作
- 避免阻塞主线程
- 后台任务隔离

### 11.2 缓存策略
- 补全结果缓存
- 文件内容缓存
- Git 信息缓存

### 11.3 防抖和节流
- 编辑器输入防抖
- 文件变更节流
- 减少不必要的 Core 请求

### 11.4 延迟加载
- 按需加载组件
- 延迟初始化服务
- 减少启动时间

---

## 12. 已知限制

### 12.1 平台限制
- 需要 IntelliJ IDEA 2022.3+
- JCEF 可能在某些环境下不可用
- 需要 Java 17+

### 12.2 性能限制
- JCEF Webview 内存占用较高
- 大型项目补全可能较慢
- 多项目并发限制

### 12.3 兼容性
- 某些 JetBrains IDE 功能差异
- 插件冲突可能性
- 快捷键冲突

---

## 13. 未来改进方向

### 13.1 性能优化
- 减少 JCEF 内存占用
- 优化补全响应时间
- 改进索引性能

### 13.2 功能增强
- 支持更多语言的 Code Lens
- 增强调试集成
- 改进差异可视化

### 13.3 用户体验
- 更好的首次启动体验
- 改进教程和文档
- 增强错误提示

---

## 14. 总结

IntelliJ IDEA 插件是 YinHai Continue 项目的重要组成部分：

✅ **架构优势**:
- 清晰的 Kotlin/Java 混合架构
- 利用 IntelliJ Platform 强大能力
- JCEF 提供现代 Web UI

✅ **功能完善**:
- 自动补全、聊天、编辑一应俱全
- Code Lens 多语言支持
- Git 和调试器集成

✅ **工程成熟**:
- Gradle 现代化构建
- 完善的测试基础设施
- 清晰的项目结构

✅ **跨平台兼容**:
- 支持所有主流 JetBrains IDE
- Windows、macOS、Linux 全支持
- 统一的 Core 进程和协议

---

**文档生成时间**: 2025-10-29  
**项目路径**: `/Users/andrewhe/Developer/Yh-work/AI-agent/code/yinhai-continue/extensions/intellij`  
**插件版本**: 1.0.33-beta
