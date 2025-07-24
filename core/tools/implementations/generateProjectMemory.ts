import { ToolImpl } from ".";
import { ChatMessage } from "../../index.js";
import { getLanceDbPath } from "../../util/paths.js";

/**
 * 清理 LLM 响应中的 markdown 代码块标记
 */
function cleanJsonResponse(content: string): string {
  let cleaned = content.trim();

  // 移除开头的 ```json 或 ```
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.substring(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.substring(3);
  }

  // 移除结尾的 ```
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.substring(0, cleaned.length - 3);
  }

  // 再次清理空白字符
  return cleaned.trim();
}

// 记忆提取提示词
const EXTRACTION_PROMPT_PART_1 = `You are a memory extractor. Your task is to extract memories from the given messages.
* You will receive a list of messages, each with a role (user or assistant) and content.
* Your job is to extract memories related to the user's long-term goals, interests, and emotional states.
* Each memory should be a dictionary with the following keys:
    - "memory": The content of the memory (string). Rephrase the content if necessary.
    - "metadata": A dictionary containing additional information about the memory.
* The metadata dictionary should include:
    - "type": The type of memory (string), e.g., "procedure", "fact", "event", "opinion", etc.
    - "memory_time": The time the memory occurred or refers to (string). Must be in standard \`YYYY-MM-DD\` format. Relative expressions such as "yesterday" or "tomorrow" are not allowed.
    - "source": The origin of the memory (string), e.g., \`"conversation"\`, \`"retrieved"\`, \`"web"\`, \`"file"\`.
    - "confidence": A numeric score (float between 0 and 100) indicating how certain you are about the accuracy or reliability of the memory.
    - "entities": A list of key entities (array of strings) mentioned in the memory, e.g., people, places, organizations, e.g., \`["Alice", "Paris", "OpenAI"]\`.
    - "tags": A list of keywords or thematic labels (array of strings) associated with the memory for categorization or retrieval, e.g., \`["travel", "health", "project-x"]\`.
    - "visibility": The accessibility scope of the memory (string), e.g., \`"private"\`, \`"public"\`, \`"session"\`, determining who or what contexts can access it.
    - "updated_at": The timestamp of the last modification to the memory (string). Useful for tracking memory freshness or change history. Format: ISO 8601 or natural language.
* Current date and time is ${new Date().toISOString()}.
* Only return the list of memories in JSON format.
* Do not include any explanations
* Do not include any extra text
* Do not include code blocks (\`\`\`json\`\`\`)

## Example

### Input

[
    {"role": "user", "content": "I plan to visit Paris next week."},
    {"role": "assistant", "content": "Paris is a beautiful city with many attractions."},
    {"role": "user", "content": "I love the Eiffel Tower."},
    {"role": "assistant", "content": "The Eiffel Tower is a must-see landmark in Paris."}
]

### Output

[
  {
    "memory": "The user plans to visit Paris on ${new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]}.",
    "metadata": {
      "type": "event",
      "memory_time": "${new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]}",
      "source": "conversation",
      "confidence": 90.0,
      "entities": ["Paris"],
      "tags": ["travel", "plans"],
      "visibility": "private",
      "updated_at": "${new Date().toISOString()}"
    }
  },
  {
    "memory": "The user loves the Eiffel Tower.",
    "metadata": {
      "type": "opinion",
      "memory_time": "${new Date().toISOString().split("T")[0]}",
      "source": "conversation",
      "confidence": 100.0,
      "entities": ["Eiffel Tower"],
      "tags": ["opinions", "landmarks"],
      "visibility": "session",
      "updated_at": "${new Date().toISOString()}"
    }
  }
]

`;

interface Memory {
  memory: string;
  metadata: {
    type: string;
    memory_time: string;
    source: string;
    confidence: number;
    entities: string[];
    tags: string[];
    visibility: string;
    updated_at: string;
  };
}

interface MemoryRow {
  id: string;
  memory: string;
  metadata: string;
  vector: number[];
  created_at: string;
  updated_at: string;
}

// 合并两个相似记忆的函数
async function mergeMemories(
  existingMemory: Memory,
  newMemory: Memory,
  llm: import("../../index.js").ILLM,
): Promise<Memory> {
  // 合并提示词
  const mergePrompt = `You are a memory merger. Your task is to merge two similar memories into one comprehensive memory.

Rules:
1. Combine the information from both memories
2. Keep the most recent and accurate information
3. Merge entities and tags (remove duplicates)
4. Use the higher confidence score
5. Update the memory_time to the most recent date
6. Keep the memory content concise but comprehensive

Existing Memory:
${JSON.stringify(existingMemory, null, 2)}

New Memory:
${JSON.stringify(newMemory, null, 2)}

Return only the merged memory in JSON format (same structure as input):`;

  try {
    console.log("🤖 [记忆合并] 使用 LLM 合并记忆");
    const response = await llm.chat(
      [{ role: "user", content: mergePrompt }],
      new AbortController().signal,
    );

    const responseContent =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    console.log("🔍 [记忆合并] 解析 LLM 合并结果");

    const cleanedContent = cleanJsonResponse(responseContent);
    console.log("🧹 [记忆合并] 清理后的内容:", cleanedContent);

    const mergedMemory = JSON.parse(cleanedContent);

    // 确保更新时间是最新的
    mergedMemory.metadata.updated_at = new Date().toISOString();

    console.log("✅ [记忆合并] LLM 合并成功");
    return mergedMemory;
  } catch (error) {
    // 如果 LLM 合并失败，使用简单的合并策略
    console.log(`⚠️ [记忆合并] LLM 合并失败，使用简单合并策略: ${error}`);

    return {
      memory: `${existingMemory.memory} ${newMemory.memory}`.trim(),
      metadata: {
        type: newMemory.metadata.type || existingMemory.metadata.type,
        memory_time:
          newMemory.metadata.memory_time > existingMemory.metadata.memory_time
            ? newMemory.metadata.memory_time
            : existingMemory.metadata.memory_time,
        source: "conversation",
        confidence: Math.max(
          existingMemory.metadata.confidence,
          newMemory.metadata.confidence,
        ),
        entities: Array.from(
          new Set([
            ...existingMemory.metadata.entities,
            ...newMemory.metadata.entities,
          ]),
        ),
        tags: Array.from(
          new Set([
            ...existingMemory.metadata.tags,
            ...newMemory.metadata.tags,
          ]),
        ),
        visibility:
          newMemory.metadata.visibility || existingMemory.metadata.visibility,
        updated_at: new Date().toISOString(),
      },
    };
  }
}

export const generateProjectMemoryImpl: ToolImpl = async (args, extras) => {
  const { chatHistory } = args;

  console.log("🚀 [记忆生成] 工具开始执行");
  console.log("📥 [记忆生成] 接收到的参数:", {
    chatHistoryLength: chatHistory?.length,
  });

  try {
    // 验证参数
    if (!chatHistory || !Array.isArray(chatHistory)) {
      console.log("❌ [记忆生成] 参数验证失败: chatHistory 不是有效数组");
      return [
        {
          name: "生成项目记忆错误",
          description: "参数验证失败",
          content: "chatHistory 参数必须是非空数组",
        },
      ];
    }

    console.log("✅ [记忆生成] 参数验证通过");

    // 获取 LLM 和 embedding 提供者
    console.log("🔍 [记忆生成] 检查 LLM 配置");
    const llm = extras.llm;

    if (!llm) {
      console.log("❌ [记忆生成] LLM 未配置");
      return [
        {
          name: "生成项目记忆错误",
          description: "LLM 未配置",
          content: "需要配置 LLM 模型来分析对话内容",
        },
      ];
    }

    console.log("✅ [记忆生成] LLM 配置检查通过");

    // 获取嵌入提供者（从配置中）
    const embeddingsProvider = extras.config?.selectedModelByRole?.embed;

    console.log("🔍 [记忆生成] 检查嵌入提供者配置");
    let embedProvider: import("../../index.js").ILLM;

    if (embeddingsProvider) {
      console.log(
        "✅ [记忆生成] 找到配置的嵌入提供者:",
        embeddingsProvider.title || embeddingsProvider.model,
      );
      embedProvider = embeddingsProvider;
    } else {
      console.log(
        "⚠️ [记忆生成] 未配置专用嵌入提供者，尝试使用 LLM 的嵌入功能",
      );

      // 检查 LLM 是否支持嵌入功能作为回退
      if (!llm.embed) {
        console.log("❌ [记忆生成] LLM 不支持嵌入功能");
        return [
          {
            name: "生成项目记忆错误",
            description: "嵌入功能未支持",
            content:
              "需要配置嵌入模型或使用支持嵌入功能的 LLM 模型来生成向量存储",
          },
        ];
      }

      embedProvider = llm;
      console.log("✅ [记忆生成] 将使用 LLM 的嵌入功能作为回退");
    }

    console.log("✅ [记忆生成] 嵌入提供者配置检查通过");

    // 准备对话消息用于 LLM 分析
    console.log("📝 [记忆生成] 处理对话消息");
    const messages: ChatMessage[] = chatHistory
      .filter((item: any) => item.message && item.message.content)
      .map((item: any) => ({
        role: item.message.role,
        content:
          typeof item.message.content === "string"
            ? item.message.content
            : JSON.stringify(item.message.content),
      }));

    console.log(`📊 [记忆生成] 处理后的消息数量: ${messages.length}`);

    if (messages.length === 0) {
      console.log("⚠️ [记忆生成] 没有有效的消息内容");
      return [
        {
          name: "生成项目记忆结果",
          description: "无有效消息",
          content: "聊天历史中没有找到有效的消息内容",
        },
      ];
    }

    // 使用 LLM 提取记忆
    console.log("🤖 [记忆生成] 开始调用 LLM 提取记忆");
    const extractionPrompt =
      EXTRACTION_PROMPT_PART_1 +
      `\n\n### Input\n\n${JSON.stringify(messages)}\n\n### Output\n\n`;

    let extractedMemories: Memory[] = [];
    try {
      console.log("📤 [记忆生成] 发送请求到 LLM");
      const response = await llm.chat(
        [{ role: "user", content: extractionPrompt }],
        new AbortController().signal,
      );

      console.log("📥 [记忆生成] 收到 LLM 响应");
      console.log(response);
      const responseContent =
        typeof response.content === "string"
          ? response.content
          : JSON.stringify(response.content);

      console.log("🔍 [记忆生成] 解析 LLM 响应内容");
      console.log(responseContent);
      try {
        const cleanedContent = cleanJsonResponse(responseContent);
        console.log("🧹 [记忆生成] 清理后的内容:", cleanedContent);

        extractedMemories = JSON.parse(cleanedContent);
        console.log(
          `✅ [记忆生成] 成功解析，提取到 ${extractedMemories.length} 个记忆`,
        );
      } catch (parseError) {
        console.log("❌ [记忆生成] LLM 响应解析失败:", parseError);
        console.log("📄 [记忆生成] 原始响应内容:", responseContent);
        return [
          {
            name: "生成项目记忆错误",
            description: "LLM 响应解析失败",
            content: `无法解析 LLM 返回的记忆数据: ${parseError}\n\n原始响应: ${responseContent}`,
          },
        ];
      }
    } catch (llmError) {
      console.log("❌ [记忆生成] LLM 调用失败:", llmError);
      return [
        {
          name: "生成项目记忆错误",
          description: "LLM 调用失败",
          content: `LLM 调用失败: ${llmError instanceof Error ? llmError.message : String(llmError)}`,
        },
      ];
    }

    if (!Array.isArray(extractedMemories) || extractedMemories.length === 0) {
      console.log("⚠️ [记忆生成] 未提取到有效记忆");
      return [
        {
          name: "生成项目记忆结果",
          description: "未提取到记忆",
          content: `# 项目记忆生成报告\n\n**生成时间:** ${new Date().toISOString()}\n\n**分析消息数:** ${messages.length}\n\n**提取结果:** 未从对话中提取到有价值的记忆内容\n\n这可能是因为：\n- 对话内容主要是技术讨论\n- 没有包含用户的长期目标或偏好\n- 对话过于简短或缺乏上下文`,
        },
      ];
    }

    // 为每个记忆生成向量嵌入并处理去重/更新
    console.log("💾 [记忆生成] 开始存储记忆到向量数据库");
    let savedMemories = 0;
    let updatedMemories = 0;
    const errors: string[] = [];
    const SIMILARITY_THRESHOLD = 0.85; // 相似度阈值，超过此值认为是相同记忆

    try {
      // 动态导入 LanceDB
      console.log("📦 [记忆生成] 导入 LanceDB");
      const lance = await import("vectordb");
      const lanceDbPath = getLanceDbPath();
      console.log("🔗 [记忆生成] 连接数据库:", lanceDbPath);
      const db = await lance.connect(lanceDbPath);

      // 创建或获取记忆表，支持动态维度检查
      const tableName = "project_memories";
      let table;
      let needRecreateTable = false;

      // 首先生成示例向量以确定当前嵌入模型的维度
      console.log("🔢 [记忆生成] 生成示例向量以确定当前嵌入模型维度");
      let sampleEmbedResult;
      try {
        sampleEmbedResult = await embedProvider.embed(["sample"]);
      } catch (embedError) {
        console.log("❌ [记忆生成] 示例嵌入调用失败:", embedError);
        throw new Error(
          `示例嵌入调用失败: ${embedError instanceof Error ? embedError.message : String(embedError)}`,
        );
      }

      // 验证示例嵌入结果格式
      if (
        !Array.isArray(sampleEmbedResult) ||
        sampleEmbedResult.length === 0
      ) {
        console.log("❌ [记忆生成] 示例嵌入结果格式错误:", {
          type: typeof sampleEmbedResult,
          isArray: Array.isArray(sampleEmbedResult),
          length: sampleEmbedResult?.length,
          result: sampleEmbedResult,
        });
        throw new Error(
          `示例嵌入结果格式错误: 期望数组，实际 ${typeof sampleEmbedResult}`,
        );
      }

      const sampleVector = sampleEmbedResult[0];
      if (!Array.isArray(sampleVector)) {
        console.log("❌ [记忆生成] 示例向量格式错误:", {
          type: typeof sampleVector,
          isArray: Array.isArray(sampleVector),
          vector: sampleVector,
        });
        throw new Error(
          `示例向量格式错误: 期望数组，实际 ${typeof sampleVector}`,
        );
      }

      const currentVectorDim = sampleVector.length;
      console.log("📏 [记忆生成] 当前嵌入模型向量维度:", currentVectorDim);

      console.log("🗂️ [记忆生成] 尝试打开记忆表:", tableName);
      try {
        table = await db.openTable(tableName);
        console.log("✅ [记忆生成] 成功打开现有记忆表");

        // 检查现有表的向量维度是否匹配
        try {
          // 尝试用当前维度的向量进行搜索，如果失败说明维度不匹配
          await table.search(sampleVector).limit(1).execute();
          console.log("✅ [记忆生成] 向量维度匹配，可以使用现有表");
        } catch (dimensionError) {
          const errorMessage = dimensionError instanceof Error ? dimensionError.message : String(dimensionError);
          console.log("⚠️ [记忆生成] 检测到向量维度不匹配:", errorMessage);
          console.log("🔄 [记忆生成] 将重新创建表以匹配当前嵌入模型维度");
          needRecreateTable = true;
        }
      } catch {
        // 表不存在
        console.log("🆕 [记忆生成] 记忆表不存在，需要创建新表");
        needRecreateTable = true;
      }

      if (needRecreateTable) {
        // 删除现有表（如果存在）
        try {
          await db.dropTable(tableName);
          console.log("🗑️ [记忆生成] 已删除现有的不兼容表");
        } catch {
          // 表不存在，忽略错误
        }

        console.log("🏗️ [记忆生成] 创建新的记忆表，向量维度:", currentVectorDim);
        table = await db.createTable(tableName, [
          {
            id: "sample_id",
            memory: "sample memory",
            metadata: JSON.stringify({}),
            vector: sampleVector,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]);

        // 删除示例行
        console.log("🧹 [记忆生成] 删除示例数据");
        await table.delete("id = 'sample_id'");
        console.log("✅ [记忆生成] 记忆表创建完成");
      }

      // 确保表已正确初始化
      if (!table) {
        console.log("❌ [记忆生成] 表初始化失败");
        throw new Error("记忆表初始化失败，无法继续处理");
      }

      // 处理每个记忆
      console.log(`🔄 [记忆生成] 开始处理 ${extractedMemories.length} 个记忆`);
      for (let i = 0; i < extractedMemories.length; i++) {
        const memory = extractedMemories[i];
        console.log(
          `📝 [记忆生成] 处理记忆 ${i + 1}/${extractedMemories.length}: "${memory.memory.substring(0, 50)}..."`,
        );

        try {
          // 生成记忆的向量嵌入
          console.log("🔢 [记忆生成] 生成向量嵌入");
          const memoryText = `${memory.memory} ${memory.metadata.tags.join(" ")} ${memory.metadata.entities.join(" ")}`;

          // 调用嵌入方法并正确处理结果
          let embedResult;
          try {
            embedResult = await embedProvider.embed([memoryText]);
          } catch (embedError) {
            console.log("❌ [记忆生成] 嵌入调用失败:", embedError);
            throw new Error(
              `嵌入调用失败: ${embedError instanceof Error ? embedError.message : String(embedError)}`,
            );
          }

          // 验证嵌入结果格式
          if (!Array.isArray(embedResult) || embedResult.length === 0) {
            console.log("❌ [记忆生成] 嵌入结果格式错误:", {
              type: typeof embedResult,
              isArray: Array.isArray(embedResult),
              length: embedResult?.length,
              result: embedResult,
            });
            throw new Error(
              `嵌入结果格式错误: 期望数组，实际 ${typeof embedResult}`,
            );
          }

          const vector = embedResult[0];
          if (!Array.isArray(vector)) {
            console.log("❌ [记忆生成] 向量格式错误:", {
              type: typeof vector,
              isArray: Array.isArray(vector),
              vector: vector,
            });
            throw new Error(`向量格式错误: 期望数组，实际 ${typeof vector}`);
          }

          console.log(`✅ [记忆生成] 向量嵌入生成完成，维度: ${vector.length}`);

          // 检查是否存在相似的记忆
          console.log("🔍 [记忆生成] 搜索相似记忆");
          let existingSimilarMemory = null;
          try {
            // 搜索相似记忆（限制搜索结果数量以提高性能）
            const searchResults = await table.search(vector).limit(5).execute();

            console.log(
              `📊 [记忆生成] 找到 ${searchResults.length} 个候选相似记忆`,
            );

            // 检查相似度
            for (const result of searchResults) {
              if (
                result._distance &&
                typeof result._distance === "number" &&
                1 - result._distance >= SIMILARITY_THRESHOLD
              ) {
                const similarity = Math.round((1 - result._distance) * 100);
                console.log(
                  `🎯 [记忆生成] 发现相似记忆，相似度: ${similarity}%`,
                );
                existingSimilarMemory = result;
                break;
              }
            }

            if (!existingSimilarMemory) {
              console.log("🆕 [记忆生成] 未发现相似记忆，将创建新记忆");
            }
          } catch (searchError) {
            // 如果搜索失败（比如表为空），继续添加新记忆
            console.log(`⚠️ [记忆生成] 搜索相似记忆失败: ${searchError}`);
          }

          if (existingSimilarMemory) {
            // 更新现有记忆
            console.log("🔄 [记忆生成] 更新现有相似记忆");
            try {
              const metadataString =
                typeof existingSimilarMemory.metadata === "string"
                  ? existingSimilarMemory.metadata
                  : JSON.stringify(existingSimilarMemory.metadata);
              const existingMetadata = JSON.parse(metadataString);

              // 合并和更新记忆内容
              const existingMemoryContent =
                typeof existingSimilarMemory.memory === "string"
                  ? existingSimilarMemory.memory
                  : String(existingSimilarMemory.memory);

              console.log("🤝 [记忆生成] 合并记忆内容");
              const updatedMemory = await mergeMemories(
                {
                  memory: existingMemoryContent,
                  metadata: existingMetadata,
                },
                memory,
                llm,
              );

              // 更新数据库中的记忆
              const existingId =
                typeof existingSimilarMemory.id === "string"
                  ? existingSimilarMemory.id
                  : String(existingSimilarMemory.id);

              console.log("💾 [记忆生成] 更新数据库记录");
              await table.update({
                where: `id = '${existingId}'`,
                values: {
                  memory: updatedMemory.memory,
                  metadata: JSON.stringify(updatedMemory.metadata),
                  vector: vector, // 使用新的向量
                  updated_at: new Date().toISOString(),
                },
              });

              updatedMemories++;
              console.log("✅ [记忆生成] 记忆更新成功");
            } catch (updateError) {
              console.log("❌ [记忆生成] 记忆更新失败:", updateError);
              errors.push(
                `更新记忆 "${memory.memory.substring(0, 50)}..." 失败: ${updateError}`,
              );
            }
          } else {
            // 创建新记忆
            console.log("🆕 [记忆生成] 创建新记忆");
            const memoryRow: MemoryRow = {
              id: `memory_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              memory: memory.memory,
              metadata: JSON.stringify(memory.metadata),
              vector: vector,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };

            // 插入到向量数据库
            console.log("💾 [记忆生成] 插入新记忆到数据库");
            await table.add([memoryRow]);
            savedMemories++;
            console.log("✅ [记忆生成] 新记忆保存成功");
          }
        } catch (memoryError) {
          console.log("❌ [记忆生成] 处理记忆失败:", memoryError);
          errors.push(
            `处理记忆 "${memory.memory.substring(0, 50)}..." 失败: ${memoryError}`,
          );
        }
      }

      console.log(
        `🎉 [记忆生成] 记忆处理完成 - 新增: ${savedMemories}, 更新: ${updatedMemories}, 错误: ${errors.length}`,
      );
    } catch (dbError) {
      return [
        {
          name: "生成项目记忆错误",
          description: "向量数据库操作失败",
          content: `向量数据库操作失败: ${dbError instanceof Error ? dbError.message : String(dbError)}`,
        },
      ];
    }

    // 生成报告
    const totalProcessed = savedMemories + updatedMemories;
    const report = `# 项目记忆生成报告

**生成时间:** ${new Date().toISOString()}

**分析消息数:** ${messages.length}

**提取的记忆数:** ${extractedMemories.length}

**新增记忆数:** ${savedMemories}

**更新记忆数:** ${updatedMemories}

**总处理记忆数:** ${totalProcessed}

## 提取的记忆内容

${extractedMemories
  .map(
    (memory, index) => `
### 记忆 ${index + 1}
- **内容:** ${memory.memory}
- **类型:** ${memory.metadata.type}
- **时间:** ${memory.metadata.memory_time}
- **置信度:** ${memory.metadata.confidence}%
- **实体:** ${memory.metadata.entities.join(", ")}
- **标签:** ${memory.metadata.tags.join(", ")}
- **可见性:** ${memory.metadata.visibility}
`,
  )
  .join("\n")}

${errors.length > 0 ? `## 错误信息\n\n${errors.map((error) => `- ${error}`).join("\n")}` : ""}

## 处理统计

- **相似度阈值:** ${SIMILARITY_THRESHOLD}
- **去重策略:** 向量相似度匹配 + LLM 智能合并
- **处理结果:** ${totalProcessed === extractedMemories.length ? "✅ 所有记忆已成功处理" : `⚠️ ${totalProcessed}/${extractedMemories.length} 记忆已处理`}

${updatedMemories > 0 ? `\n**记忆更新:** 检测到 ${updatedMemories} 个相似记忆并进行了智能合并更新` : ""}`;

    return [
      {
        name: "项目记忆生成结果",
        description: "项目长期记忆生成和存储完成",
        content: report,
      },
    ];
  } catch (error) {
    console.log("💥 [记忆生成] 发生未预期错误:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return [
      {
        name: "生成项目记忆错误",
        description: "生成项目记忆过程中发生错误",
        content: `生成项目记忆时发生错误: ${errorMessage}\n\n请检查：\n1. LLM 模型配置是否正确\n2. 嵌入模型配置是否正确\n3. 网络连接是否正常\n4. API 密钥是否有效`,
      },
    ];
  } finally {
    console.log("🏁 [记忆生成] 工具执行结束");
  }
};
