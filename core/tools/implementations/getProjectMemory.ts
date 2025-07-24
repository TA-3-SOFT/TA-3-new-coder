import { ToolImpl } from ".";
import { getLanceDbPath } from "../../util/paths.js";

interface MemoryMetadata {
  type: string;
  memory_time: string;
  source: string;
  confidence: number;
  entities: string[];
  tags: string[];
  visibility: string;
  updated_at: string;
}

interface StoredMemory {
  id: string;
  memory: string;
  metadata: string;
  created_at: string;
  updated_at: string;
  _distance?: number;
}

export const getProjectMemoryImpl: ToolImpl = async (args, extras) => {
  const { userInput } = args;

  try {
    // 验证参数
    if (!userInput || typeof userInput !== "string") {
      return [
        {
          name: "获取项目记忆错误",
          description: "参数验证失败",
          content: "userInput 参数必须是非空字符串",
        },
      ];
    }

    const llm = extras.llm;

    if (!llm) {
      return [
        {
          name: "获取项目记忆错误",
          description: "LLM 未配置",
          content: "需要配置 LLM 模型来进行向量搜索",
        },
      ];
    }

    // 获取嵌入提供者（从配置中）
    const embeddingsProvider = extras.config?.selectedModelByRole?.embed;

    console.log("🔍 [记忆检索] 检查嵌入提供者配置");
    let embedProvider: import("../../index.js").ILLM;

    if (embeddingsProvider) {
      console.log(
        "✅ [记忆检索] 找到配置的嵌入提供者:",
        embeddingsProvider.title || embeddingsProvider.model,
      );
      embedProvider = embeddingsProvider;
    } else {
      console.log(
        "⚠️ [记忆检索] 未配置专用嵌入提供者，尝试使用 LLM 的嵌入功能",
      );

      // 检查 LLM 是否支持嵌入功能作为回退
      if (!llm.embed) {
        console.log("❌ [记忆检索] LLM 不支持嵌入功能");
        return [
          {
            name: "获取项目记忆错误",
            description: "嵌入功能未支持",
            content:
              "需要配置嵌入模型或使用支持嵌入功能的 LLM 模型来进行向量搜索",
          },
        ];
      }

      embedProvider = llm;
      console.log("✅ [记忆检索] 将使用 LLM 的嵌入功能作为回退");
    }

    console.log("✅ [记忆检索] 嵌入提供者配置检查通过");

    try {
      // 动态导入 LanceDB
      const lance = await import("vectordb");
      const lanceDbPath = getLanceDbPath();
      const db = await lance.connect(lanceDbPath);

      // 获取记忆表
      const tableName = "project_memories";
      let table;

      try {
        table = await db.openTable(tableName);
      } catch {
        return [
          {
            name: "项目记忆检索结果",
            description: "记忆数据库为空",
            content: `# 项目记忆检索结果\n\n**查询内容:** ${userInput}\n\n**结果:** 暂无记忆数据\n\n记忆数据库尚未创建或为空。请先使用"生成项目记忆"工具创建一些记忆。`,
          },
        ];
      }

      // 如果用户输入是 "all" 或 "所有"，返回所有记忆
      if (userInput.toLowerCase() === "all" || userInput === "所有") {
        const allMemories = (await table
          .filter("id IS NOT NULL")
          .limit(100)
          .execute()) as StoredMemory[];

        if (allMemories.length === 0) {
          return [
            {
              name: "项目记忆检索结果",
              description: "记忆数据库为空",
              content: `# 所有项目记忆\n\n**结果:** 暂无记忆数据\n\n记忆数据库中没有找到任何记忆。`,
            },
          ];
        }

        const memoryList = allMemories
          .map((memory, index) => {
            let metadata: MemoryMetadata;
            try {
              const metadataString =
                typeof memory.metadata === "string"
                  ? memory.metadata
                  : JSON.stringify(memory.metadata);
              metadata = JSON.parse(metadataString);
            } catch {
              metadata = {
                type: "unknown",
                memory_time: "unknown",
                source: "conversation",
                confidence: 0,
                entities: [],
                tags: [],
                visibility: "private",
                updated_at: memory.updated_at || "unknown",
              };
            }

            const memoryContent =
              typeof memory.memory === "string"
                ? memory.memory
                : String(memory.memory);

            return `## 📝 记忆 ${index + 1}

**💭 内容:** ${memoryContent}

**📊 详细信息:**
- **⏰ 记忆时间:** ${metadata.memory_time}
- **🎯 置信度:** ${metadata.confidence}%
- **👥 相关实体:** ${metadata.entities.length > 0 ? metadata.entities.join(", ") : "无"}
- **🏷️ 标签:** ${metadata.tags.length > 0 ? metadata.tags.join(", ") : "无"}
- **📅 创建时间:** ${memory.created_at}
- **🔄 更新时间:** ${memory.updated_at}

---
`;
          })
          .join("\n");

        return [
          {
            name: "项目记忆检索结果",
            description: "所有项目记忆",
            content: `# 🧠 所有项目记忆
${memoryList}
`,
          },
        ];
      }

      // 进行向量搜索
      let embedResult;
      try {
        embedResult = await embedProvider.embed([userInput]);
      } catch (embedError) {
        console.log("❌ [记忆检索] 嵌入调用失败:", embedError);
        return [
          {
            name: "获取项目记忆错误",
            description: "嵌入调用失败",
            content: `嵌入调用失败: ${embedError instanceof Error ? embedError.message : String(embedError)}`,
          },
        ];
      }

      // 验证嵌入结果格式
      if (!Array.isArray(embedResult) || embedResult.length === 0) {
        console.log("❌ [记忆检索] 嵌入结果格式错误:", {
          type: typeof embedResult,
          isArray: Array.isArray(embedResult),
          length: embedResult?.length,
          result: embedResult,
        });
        return [
          {
            name: "获取项目记忆错误",
            description: "嵌入结果格式错误",
            content: `嵌入结果格式错误: 期望数组，实际 ${typeof embedResult}`,
          },
        ];
      }

      const queryVector = embedResult[0];
      if (!Array.isArray(queryVector)) {
        console.log("❌ [记忆检索] 向量格式错误:", {
          type: typeof queryVector,
          isArray: Array.isArray(queryVector),
          vector: queryVector,
        });
        return [
          {
            name: "获取项目记忆错误",
            description: "向量格式错误",
            content: `向量格式错误: 期望数组，实际 ${typeof queryVector}`,
          },
        ];
      }
      const searchResults = (await table
        .search(queryVector)
        .limit(10)
        .execute()) as StoredMemory[];

      if (searchResults.length === 0) {
        return [
          {
            name: "项目记忆检索结果",
            description: "未找到相关记忆",
            content: `# 项目记忆检索结果\n\n**查询内容:** ${userInput}\n\n**结果:** 未找到相关记忆\n\n没有找到与您的查询相关的记忆内容。`,
          },
        ];
      }

      // 格式化搜索结果
      const relevantMemories = searchResults
        .map((memory, index) => {
          let metadata: MemoryMetadata;
          try {
            const metadataString =
              typeof memory.metadata === "string"
                ? memory.metadata
                : JSON.stringify(memory.metadata);
            metadata = JSON.parse(metadataString);
          } catch {
            metadata = {
              type: "unknown",
              memory_time: "unknown",
              source: "conversation",
              confidence: 0,
              entities: [],
              tags: [],
              visibility: "private",
              updated_at: memory.updated_at || "unknown",
            };
          }

          const memoryContent =
            typeof memory.memory === "string"
              ? memory.memory
              : String(memory.memory);

          const similarity =
            memory._distance && typeof memory._distance === "number"
              ? Math.round((1 - memory._distance) * 100)
              : 0;

          // 根据相似度设置不同的图标
          const similarityIcon =
            similarity >= 90 ? "🎯" : similarity >= 70 ? "🔍" : "📌";
          const relevanceLevel =
            similarity >= 90
              ? "高度相关"
              : similarity >= 70
                ? "中度相关"
                : "低度相关";

          return `## ${similarityIcon} 记忆 ${index + 1} - ${relevanceLevel} (${similarity}%)

**💭 内容:** ${memoryContent}

**📊 详细信息:**
- **⏰ 记忆时间:** ${metadata.memory_time}
- **🎯 置信度:** ${metadata.confidence}%
- **👥 相关实体:** ${metadata.entities.length > 0 ? metadata.entities.join(", ") : "无"}
- **🏷️ 标签:** ${metadata.tags.length > 0 ? metadata.tags.join(", ") : "无"}
- **🔄 更新时间:** ${memory.updated_at}

---
`;
        })
        .join("\n");

      return [
        {
          name: "项目记忆检索结果",
          description: "相关项目记忆",
          content: `# 🔍 项目记忆检索结果

**📝 查询信息:**
- **查询内容:** ${userInput}
- **找到记忆数:** ${searchResults.length}
- **查询时间:** ${new Date().toLocaleString()}

${relevantMemories}
`,
        },
      ];
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return [
        {
          name: "获取项目记忆错误",
          description: "LanceDB 操作错误",
          content: `LanceDB 操作时发生错误: ${errorMessage}`,
        },
      ];
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return [
      {
        name: "获取项目记忆错误",
        description: "获取项目记忆过程中发生错误",
        content: `获取项目记忆时发生错误: ${errorMessage}`,
      },
    ];
  }
};
