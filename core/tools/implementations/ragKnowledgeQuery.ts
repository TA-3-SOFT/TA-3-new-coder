import { ToolImpl } from ".";
import { getKnowledgeApiServiceWithAuth } from "../../util/knowledgeApiService";

interface RagQueryResult {
  content: string;
  source: string;
  score?: number;
  metadata?: Record<string, any>;
}

interface RagApiResponse {
  answer: string;
  results: RagQueryResult[];
  query?: string;
  total_results?: number;
}

// 定义文档片段接口
interface DocumentChunk {
  content: string;
  source: string;
  index: number;
  total: number;
  metadata?: Record<string, any>;
}

export const ragKnowledgeQueryImpl: ToolImpl = async (args, extras) => {
  const { query, appid } = args;

  if (!query || typeof query !== "string" || query.trim().length === 0) {
    throw new Error("查询内容不能为空");
  }

  // 获取组织信息
  let orgId: any = null;
  try {
    // 尝试从extras中获取组织信息
    // orgId = extras.config.selectedOrgId;
    orgId = "4176c7786222421ba4e351fd404b8488";
    // orgId = "40FC1A880000456184F8E98396A1645F";
  } catch (orgError) {
    console.warn("⚠️ [RAG查询] 无法获取组织信息:", orgError);
  }

  // 如果传入了appid参数，则使用appid，否则使用orgId
  const appId = appid || orgId;

  try {
    // 获取带认证的知识库API服务实例
    const knowledgeApi = getKnowledgeApiServiceWithAuth(
      extras.config.controlPlaneClient,
    );

    // 第一步：获取所有文档列表
    const listParams: any = {
      appId: appId,
    };

    const allDocuments = await knowledgeApi.listDocuments(listParams);

    if (allDocuments.length === 0) {
      return [
        {
          name: "RAG知识库查询结果",
          description: `查询: ${query} (0 个结果)`,
          content: `# 查询结果
未找到任何知识库文档。
`,
        },
      ];
    }

    // 构造文档摘要信息供LLM选择
    const documentSummaries = allDocuments.map((doc, index) => {
      return {
        id: index + 1,
        fileName: doc.fileName,
        summary: doc.fileSummary || "无摘要",
      };
    });

    // 构造提示词，让LLM选择相关文档
    let prompt = `我有一个查询请求: "${query}"

请根据这个查询，从以下文档列表中选择最相关的几个文档（最多5个），并返回它们的编号。

文档列表:
`;

    documentSummaries.forEach((doc) => {
      // 转义文件名和摘要中的特殊字符
      const escapedFileName = doc.fileName
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n");
      const escapedSummary = (doc.summary || "无摘要")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n");
      prompt += `${doc.id}. ${escapedFileName}\n   摘要: ${escapedSummary}\n\n`;
    });

    prompt += `请只返回编号，用逗号分隔，例如: "1,3,5"。如果不相关，请返回"无"。`;

    // 使用longcontext模型而不是默认的extras.llm
    const longContextLLM = extras.config?.selectedModelByRole?.longcontext;
    const llmToUse = longContextLLM || extras.llm;

    const abortController = new AbortController();
    const llmResponse = await llmToUse.chat(
      [{ role: "user", content: prompt }],
      abortController.signal, // signal
      {
        temperature: 0.0,
      },
    );

    // 提取LLM响应内容
    let selectedDocIdsStr = "";
    if (typeof llmResponse.content === "string") {
      selectedDocIdsStr = llmResponse.content.trim();
    } else if (Array.isArray(llmResponse.content)) {
      // 如果是数组，提取其中的文本内容
      selectedDocIdsStr = llmResponse.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("")
        .trim();
    }

    // 解析LLM返回的文档编号
    let selectedDocuments: any[] = []; // 修复类型错误
    if (selectedDocIdsStr && selectedDocIdsStr.trim() !== "无") {
      try {
        // 提取数字（编号）
        const ids = selectedDocIdsStr.match(/\d+/g);
        if (ids) {
          const uniqueIds = [
            ...new Set(
              ids
                .map((id) => parseInt(id))
                .filter((id) => id > 0 && id <= allDocuments.length),
            ),
          ];
          selectedDocuments = uniqueIds
            .slice(0, 5)
            .map((id) => allDocuments[id - 1]);
        }
      } catch (parseError) {
        console.warn("⚠️ [RAG查询] 解析LLM返回的文档编号时出错:", parseError);
        // 如果解析失败，默认选择前3个文档
        selectedDocuments = allDocuments.slice(
          0,
          Math.min(3, allDocuments.length),
        );
      }
    }

    if (selectedDocuments.length === 0) {
      return [
        {
          name: "RAG知识库查询结果",
          description: `查询: ${query} (0 个结果)`,
          content: `# 查询结果

未找到与查询相关的内容。

`,
        },
      ];
    }

    // 第二步：获取选中文档的详细内容
    const detailedDocuments = [];
    for (const doc of selectedDocuments) {
      try {
        const viewParams = {
          appId: appId,
          documentId: doc.id,
        };
        const detailedDoc = await knowledgeApi.viewDocument(viewParams);
        detailedDocuments.push(detailedDoc);
      } catch (error) {
        console.warn(
          `⚠️ [RAG查询] 获取文档 ${doc.fileName} 详情时出错:`,
          error,
        );
        detailedDocuments.push(null);
      }
    }

    // 过滤掉获取失败的文档
    const validDocuments = detailedDocuments.filter((doc) => doc !== null);

    // 处理文档内容，先对每个文档进行详细总结
    const docSummaries = [];
    for (const doc of validDocuments) {
      // 检查文档大小，如果超过阈值则进行切割
      const CHUNK_SIZE = 400000; // 每个片段最大字符数
      const content = doc!.content;
      const fileName = doc!.fileName || "未知来源";

      let summary = "";
      if (content.length <= CHUNK_SIZE) {
        // 文档较小，直接处理
        summary = await processDocumentWithLLMForDetail(
          query,
          content,
          llmToUse,
        );
      } else {
        // 切割文档
        const chunks = splitDocumentIntoChunks(content, CHUNK_SIZE, fileName);

        // 分别处理每个片段
        const chunkSummaries = [];
        for (const chunk of chunks) {
          const chunkSummary = await processDocumentChunkWithLLM(
            query,
            chunk,
            llmToUse,
          );
          chunkSummaries.push(chunkSummary);
        }

        // 合并所有片段的总结
        const combinedSummary = chunkSummaries.join("\n\n");

        // 如果合并后的内容仍然很长，再次总结
        if (combinedSummary.length > CHUNK_SIZE) {
          summary = await processDocumentWithLLMForDetail(
            query,
            combinedSummary,
            llmToUse,
          );
        } else {
          summary = combinedSummary;
        }
      }

      docSummaries.push({
        fileName,
        summary,
      });
    }

    // 基于所有文档的详细总结生成最终简洁答案
    let allSummariesContent = "";
    docSummaries.forEach((docSummary) => {
      allSummariesContent += `\n\n文档: ${docSummary.fileName}\n${docSummary.summary}`;
    });

    const finalAnswer = await processDocumentWithLLMForFinal(
      query,
      allSummariesContent,
      llmToUse,
    );

    // 格式化返回结果
    return [
      {
        name: "RAG知识库查询结果",
        description: `查询: ${query}`,
        content: `# RAG知识库查询结果

**查询内容:** ${query}

${finalAnswer}`,
      },
    ];
  } catch (error) {
    console.error("❌ [RAG查询] 查询失败:", error);

    // 返回错误信息而不是抛出异常，让用户知道发生了什么
    return [
      {
        name: "RAG知识库查询失败",
        description: `查询内容: ${query}`,
        content: `# RAG知识库查询失败

**查询内容:** ${query}
**错误信息:** ${error instanceof Error ? error.message : String(error)}
`,
      },
    ];
  }
};

/**
 * 将文档切割成多个片段
 */
function splitDocumentIntoChunks(
  content: string,
  chunkSize: number,
  source: string,
): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];

  // 按段落切割文档，尽量保持语义完整
  const paragraphs = content.split("\n\n");
  let currentChunk = "";
  let chunkIndex = 0;

  for (const paragraph of paragraphs) {
    // 如果加上当前段落后超过块大小，就保存当前块并开始新块
    if (
      currentChunk.length + paragraph.length > chunkSize &&
      currentChunk.length > 0
    ) {
      chunks.push({
        content: currentChunk,
        source: source,
        index: chunkIndex,
        total: 0, // 稍后更新
      });
      currentChunk = paragraph + "\n\n";
      chunkIndex++;
    } else {
      currentChunk += paragraph + "\n\n";
    }
  }

  // 添加最后一个块
  if (currentChunk.length > 0) {
    chunks.push({
      content: currentChunk,
      source: source,
      index: chunkIndex,
      total: 0, // 稍后更新
    });
  }

  // 更新每个块的total字段
  const total = chunks.length;
  chunks.forEach((chunk) => {
    chunk.total = total;
  });

  return chunks;
}

/**
 * 使用LLM处理整个文档，生成详细总结
 */
async function processDocumentWithLLMForDetail(
  query: string,
  content: string,
  llm: any,
): Promise<string> {
  // 对query和content进行转义处理，避免特殊字符导致JSON解析错误
  const escapedQuery = query.replace(/"/g, '\\"').replace(/\n/g, "\\n");
  const escapedContent = content.replace(/"/g, '\\"').replace(/\n/g, "\\n");

  const prompt = `根据以下查询请求：

"${escapedQuery}"

请分析并总结以下文档内容，提取与查询最相关的信息，提供详细且全面的总结。要求：
1. 提供详细的信息，涵盖文档中与查询相关的主要内容
2. 保留重要的技术细节和数据
3. 可以引用关键信息，但不要大量复制原文
4. 保持结构清晰，便于后续进一步处理

文档内容：
${escapedContent}`;

  try {
    const abortController = new AbortController();
    const response = await llm.chat(
      [{ role: "user", content: prompt }],
      abortController.signal,
      {
        temperature: 0.3,
      },
    );

    if (typeof response.content === "string") {
      return response.content.trim();
    } else if (Array.isArray(response.content)) {
      // 尝试处理可能的JSON解析错误
      try {
        return response.content
          .filter((part: any) => part.type === "text")
          .map((part: any) => part.text)
          .join("")
          .trim();
      } catch (parseError) {
        console.warn("⚠️ [RAG查询] 解析LLM响应数组时出错:", parseError);
        // 返回原始响应内容的字符串表示
        return JSON.stringify(response.content);
      }
    }

    return "无法处理文档内容";
  } catch (error) {
    console.error("❌ [RAG查询] LLM处理文档时出错:", error);
    // 提供更详细的错误信息
    if (error instanceof Error && error.message.includes("JSON")) {
      return `处理文档时JSON解析出错: 可能是LLM返回了格式不正确的响应`;
    }
    return `处理文档时出错: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * 使用LLM处理文档片段
 */
async function processDocumentChunkWithLLM(
  query: string,
  chunk: DocumentChunk,
  llm: any,
): Promise<string> {
  // 对query和content进行转义处理，避免特殊字符导致JSON解析错误
  const escapedQuery = query.replace(/"/g, '\\"').replace(/\n/g, "\\n");
  const escapedContent = chunk.content
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");

  const prompt = `根据以下查询请求：

"${escapedQuery}"

请分析以下文档片段，提取与查询最相关的信息。这是第${chunk.index + 1}/${chunk.total}个片段：

${escapedContent}

请提供简洁明了的总结，重点突出与查询相关的内容：`;

  try {
    const abortController = new AbortController();
    const response = await llm.chat(
      [{ role: "user", content: prompt }],
      abortController.signal,
      {
        temperature: 0.3,
      },
    );

    if (typeof response.content === "string") {
      return response.content.trim();
    } else if (Array.isArray(response.content)) {
      // 尝试处理可能的JSON解析错误
      try {
        return response.content
          .filter((part: any) => part.type === "text")
          .map((part: any) => part.text)
          .join("")
          .trim();
      } catch (parseError) {
        console.warn("⚠️ [RAG查询] 解析LLM响应数组时出错:", parseError);
        // 返回原始响应内容的字符串表示
        return JSON.stringify(response.content);
      }
    }

    return "无法处理文档片段";
  } catch (error) {
    console.error(
      `❌ [RAG查询] LLM处理文档片段 ${chunk.index + 1}/${chunk.total} 时出错:`,
      error,
    );
    // 提供更详细的错误信息
    if (error instanceof Error && error.message.includes("JSON")) {
      return `处理文档片段时JSON解析出错: 可能是LLM返回了格式不正确的响应`;
    }
    return `处理文档片段时出错: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * 使用LLM处理多个文档总结，生成最终简洁答案
 */
async function processDocumentWithLLMForFinal(
  query: string,
  content: string,
  llm: any,
): Promise<string> {
  // 对query和content进行转义处理，避免特殊字符导致JSON解析错误
  const escapedQuery = query.replace(/"/g, '\\"').replace(/\n/g, "\\n");
  const escapedContent = content.replace(/"/g, '\\"').replace(/\n/g, "\\n");

  const prompt = `根据以下查询请求：

"${escapedQuery}"

请分析以下各个文档的总结内容，提供一个精准、简洁的最终答案。要求：
1. 只输出最终答案，不需要解释过程
2. 不要引用原文内容
3. 不要分点说明
4. 不需要按文档分别说明
5. 保持内容简洁明了

各文档总结内容：
${escapedContent}`;

  try {
    const abortController = new AbortController();
    const response = await llm.chat(
      [{ role: "user", content: prompt }],
      abortController.signal,
      {
        temperature: 0.3,
      },
    );

    if (typeof response.content === "string") {
      return response.content.trim();
    } else if (Array.isArray(response.content)) {
      // 尝试处理可能的JSON解析错误
      try {
        return response.content
          .filter((part: any) => part.type === "text")
          .map((part: any) => part.text)
          .join("")
          .trim();
      } catch (parseError) {
        console.warn("⚠️ [RAG查询] 解析LLM响应数组时出错:", parseError);
        // 返回原始响应内容的字符串表示
        return JSON.stringify(response.content);
      }
    }

    return "无法处理文档内容";
  } catch (error) {
    console.error("❌ [RAG查询] LLM处理文档时出错:", error);
    // 提供更详细的错误信息
    if (error instanceof Error && error.message.includes("JSON")) {
      return `处理文档时JSON解析出错: 可能是LLM返回了格式不正确的响应`;
    }
    return `处理文档时出错: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * 格式化RAG查询结果
 */
function formatRagResults(query: string, data: RagApiResponse) {
  const { answer, results = [] } = data;

  let content = `# RAG知识库查询结果\n\n`;
  content += `**查询内容:** ${query}\n`;

  if (answer && answer.trim()) {
    content += `## 智能回答

${answer.trim()}

`;
  }

  if (results.length > 0) {
    content += `## 相关知识片段\n\n`;

    results.forEach((result, index) => {
      content += `### ${index + 1}. ${result.source || "未知来源"}\n\n`;

      if (result.score !== undefined) {
        content += `**相关度:** ${(result.score * 100).toFixed(1)}%\n\n`;
      }

      content += `${result.content}\n\n`;

      if (result.metadata) {
        content += `**元数据:** ${JSON.stringify(result.metadata, null, 2)}\n\n`;
      }

      content += `---\n\n`;
    });
  } else {
    content += `## 查询结果

未找到与 "${query}" 相关的知识内容。

`;
  }

  return [
    {
      name: "RAG知识库查询结果",
      description: `查询: ${query} (${results.length} 个结果)}`,
      content,
    },
  ];
}
