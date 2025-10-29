# YinHai Continue 技术栈详细信息

## 语言和运行时

### TypeScript
- **版本**: 5.6.3
- **配置**: 严格模式（strict mode）
- **目标**: ESNext
- **模块系统**: ESM (ES Modules)
- **模块解析**: Bundler

### Node.js
- **最低版本**: 20.19.0
- **推荐版本**: 20.x LTS
- **特性使用**: ES Modules, Top-level await, 现代 API

---

## 前端技术栈

### 核心框架
| 技术 | 版本 | 用途 |
|------|------|------|
| **React** | 18.2.0 | UI 框架 |
| **React DOM** | 18.2.0 | DOM 渲染 |
| **TypeScript** | 5.6.3 | 类型系统 |

### 状态管理
| 技术 | 版本 | 用途 |
|------|------|------|
| **@reduxjs/toolkit** | 2.3.0 | 状态管理 |
| **react-redux** | 8.0.5 | React-Redux 绑定 |
| **redux-persist** | - | 本地存储持久化 |

### 构建工具
| 技术 | 版本 | 用途 |
|------|------|------|
| **Vite** | 6.3.4 | 构建工具 + Dev Server |
| **esbuild** | 0.17/0.19 | 快速打包器 |
| **Webpack** | via Vite | 生产构建 |

### 样式和 UI
| 技术 | 版本 | 用途 |
|------|------|------|
| **Tailwind CSS** | 3.2.7 | CSS 框架 |
| **styled-components** | 5.3 | CSS-in-JS |
| **PostCSS** | - | CSS 处理 |

### UI 组件和交互
| 技术 | 版本 | 用途 |
|------|------|------|
| **react-markdown** | 9.0.1 | Markdown 渲染 |
| **@tiptap/\*** | 2.3.2 | 富文本编辑器 |
| **react-router-dom** | 6.14.2 | 路由 |
| **framer-motion** | - | 动画 |

---

## 后端技术栈 (Core)

### 核心依赖
| 技术 | 版本 | 用途 |
|------|------|------|
| **socket.io-client** | 4.7.3 | WebSocket 通信 |
| **axios** | 1.6.7 | HTTP 请求 |
| **sqlite3** | 5.1.7 | 本地数据存储 |

### 向量和索引
| 技术 | 版本 | 用途 |
|------|------|------|
| **@lancedb/vectordb** | 0.4.20 | 向量存储 |
| **@xenova/transformers** | 2.14.0 | 设备端 embeddings |
| **web-tree-sitter** | 0.21.0 | 代码解析 |

### LLM 集成
| 技术 | 版本 | 用途 |
|------|------|------|
| **openai** | 4.76.0 | OpenAI API |
| **@anthropic-ai/sdk** | - | Anthropic Claude API |
| **@google/generative-ai** | - | Google Gemini API |
| **@aws-sdk/\*** | 3.77x | AWS Bedrock/SageMaker |
| **@modelcontextprotocol/sdk** | 1.12.0 | MCP 协议支持 |

### 配置和验证
| 技术 | 版本 | 用途 |
|------|------|------|
| **yaml** | 2.4.2 | YAML 解析 |
| **zod** | 3.24.2 | Schema 验证 |
| **joi** | - | 数据验证 |

### Web 自动化
| 技术 | 版本 | 用途 |
|------|------|------|
| **puppeteer** | 22.4.0 | 浏览器自动化 |
| **cheerio** | 1.0.0-rc.12 | HTML 解析 |

### 工具库
| 技术 | 版本 | 用途 |
|------|------|------|
| **diff** | 7.0.0 | Diff 生成 |
| **commander** | 12.0.0 | CLI 参数解析 |
| **handlebars** | 4.7.8 | 模板渲染 |
| **glob** | - | 文件匹配 |
| **ignore** | - | .gitignore 解析 |

---

## IDE 集成

### VS Code 扩展
| 技术 | 版本 | 用途 |
|------|------|------|
| **vscode API** | 1.70+ | VS Code 扩展 API |
| **Language Server Protocol** | - | LSP 集成 |
| **Webview API** | - | 嵌入式 Web 视图 |

### IntelliJ 插件
| 技术 | 版本 | 用途 |
|------|------|------|
| **Gradle** | 7.x | 构建工具 |
| **Kotlin** | - | 插件开发语言 |
| **IntelliJ Platform SDK** | - | JetBrains 插件 SDK |

---

## 测试

### 测试框架
| 技术 | 版本 | 用途 |
|------|------|------|
| **Jest** | 29.7.0 | 单元测试 (Core) |
| **Vitest** | 3.1.4 | 快速单元测试 (GUI) |
| **@testing-library/react** | - | React 组件测试 |
| **@testing-library/jest-dom** | - | DOM 匹配器 |

### 代码质量
| 技术 | 版本 | 用途 |
|------|------|------|
| **ESLint** | 8.x | 代码检查 |
| **Prettier** | 3.3.3 | 代码格式化 |
| **@biomejs/biome** | 1.6.4 | 快速 Linter/Formatter |
| **TypeScript** | 5.6.3 | 类型检查 |

---

## 开发工具

### 构建和打包
| 技术 | 版本 | 用途 |
|------|------|------|
| **esbuild** | 0.17/0.19 | 快速打包 |
| **Vite** | 6.3.4 | 前端构建 |
| **pkg** | - | 二进制打包 |
| **Gradle** | 7.x | IntelliJ 构建 |

### 开发辅助
| 技术 | 版本 | 用途 |
|------|------|------|
| **concurrently** | 9.1.2 | 并行任务运行 |
| **nodemon** | - | 自动重启 |
| **ts-node** | - | TypeScript 执行 |
| **tsx** | - | TypeScript 执行器 |

### 版本控制和 CI/CD
| 技术 | 用途 |
|------|------|
| **Git** | 版本控制 |
| **GitHub Actions** | CI/CD 流水线 |
| **Changesets** | 版本管理 |

---

## 数据存储

### 本地存储
| 技术 | 用途 |
|------|------|
| **SQLite3** | 聊天历史、开发数据 |
| **LanceDB** | 向量索引存储 |
| **File System** | 配置、缓存、日志 |

### 位置
- **配置**: `~/.continue/config.yaml`
- **索引**: `~/.continue/index/`
- **日志**: `~/.continue/logs/`
- **缓存**: `~/.continue/cache/`

---

## 网络和通信

### 协议
| 协议 | 用途 |
|------|------|
| **IPC** | IDE <-> Core (本地) |
| **TCP** | IDE <-> Core (远程) |
| **WebSocket** | GUI <-> Core (实时) |
| **HTTP/HTTPS** | LLM API 调用 |

### 通信库
- **socket.io**: WebSocket 封装
- **axios**: HTTP 客户端
- **node:net**: TCP 原生支持
- **node:child_process**: IPC 进程间通信

---

## LLM 提供商 SDK

### 官方 SDK
| 提供商 | SDK | 版本 |
|--------|-----|------|
| **OpenAI** | openai | 4.76.0 |
| **Anthropic** | @anthropic-ai/sdk | - |
| **Google** | @google/generative-ai | - |
| **AWS** | @aws-sdk/* | 3.77x |
| **Azure** | @azure/openai | - |

### 社区/第三方
- **Ollama**: HTTP API
- **LM Studio**: OpenAI-compatible API
- **Replicate**: HTTP API
- **HuggingFace**: transformers.js

---

## 代码解析和分析

### Tree-sitter
- **用途**: 语法感知的代码解析
- **支持语言**: 40+ 种编程语言
- **文件**: `/core/util/treeSitter.ts`

### Embeddings
- **Transformers.js**: 本地 embeddings 生成
- **模型**: all-MiniLM-L6-v2（默认）
- **支持**: OpenAI embeddings API

---

## 安全和认证

### 认证系统
- OAuth 2.0 集成
- Token 管理
- Control Plane 客户端

### 分析和遥测
- **PostHog**: 产品分析
- **自定义遥测**: 使用情况统计

---

## 包管理

### npm Workspaces
- **Root**: 定义 workspaces
- **Packages**: 7 个共享包
- **依赖提升**: 优化磁盘使用

### Monorepo 结构
```
yinhai-continue/
├── package.json (root)
├── core/package.json
├── gui/package.json
├── binary/package.json
├── extensions/vscode/package.json
└── packages/*/package.json
```

---

## 性能优化

### 构建优化
- **esbuild**: 快速打包 (10-100x faster)
- **Vite**: 极速 HMR (Hot Module Replacement)
- **Tree-shaking**: 移除未使用代码
- **Code splitting**: 按需加载

### 运行时优化
- **LRU 缓存**: 补全结果缓存
- **流式处理**: 减少内存占用
- **Worker Threads**: 并行处理（索引）
- **延迟加载**: 按需导入模块

---

## 文档工具

### Docusaurus
- 位置: `/docs`
- 用途: 项目文档网站
- 构建: `npm run docs:build`

---

## 总结

### 技术选型特点
✅ **现代化**: TypeScript 5.6+, React 18, Node.js 20+  
✅ **高性能**: esbuild, Vite, LanceDB  
✅ **类型安全**: 严格 TypeScript, Zod 验证  
✅ **可扩展**: 插件架构, 60+ LLM 提供商  
✅ **开发体验**: HMR, 并行构建, 快速测试  

### 依赖管理
- **Total dependencies**: ~500+
- **安全更新**: 定期更新
- **License**: 主要 MIT/Apache 2.0