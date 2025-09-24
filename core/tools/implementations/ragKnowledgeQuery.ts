import { ToolImpl } from ".";
import {
  KnowledgeApiService,
  getKnowledgeApiServiceWithAuth,
} from "../../util/knowledgeApiService";

let knowledgeApi: KnowledgeApiService | null = null;

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
  const { query } = args;

  if (!query || typeof query !== "string" || query.trim().length === 0) {
    throw new Error("查询内容不能为空");
  }

  // 获取组织信息
  let orgId: any = null;
  try {
    // 尝试从extras中获取组织信息
    // orgId = extras.config.selectedOrgId;
    orgId = "1cb76ad6656c415d87616b5a421668f1";
  } catch (orgError) {
    console.warn("⚠️ [RAG查询] 无法获取组织信息:", orgError);
  }

  try {
    console.log(`🔍 [RAG查询] 开始查询: "${query}"`);

    // 获取带认证的知识库API服务实例
    const knowledgeApi = getKnowledgeApiServiceWithAuth(
      extras.config.controlPlaneClient,
    );

    // 第一步：获取所有文档列表
    const listParams: any = {
      appId: orgId,
    };

    const allDocuments = await knowledgeApi.listDocuments(listParams);
    console.log(`✅ [RAG查询] 获取到 ${allDocuments.length} 个文档`);

    if (allDocuments.length === 0) {
      return [
        {
          name: "RAG知识库查询结果",
          description: `查询: ${query} (0 个结果)`,
          content: `# RAG知识库查询结果

**查询内容:** ${query}

## 查询结果

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
        fileType: doc.fileType || "未知类型",
      };
    });

    // 构造提示词，让LLM选择相关文档
    let prompt = `我有一个查询请求: "${query}"

请根据这个查询，从以下文档列表中选择最相关的几个文档（最多5个），并返回它们的编号。

文档列表:
`;

    documentSummaries.forEach((doc) => {
      prompt += `${doc.id}. ${doc.fileName} (${doc.fileType})\n   摘要: ${doc.summary}\n\n`;
    });

    prompt += `请只返回编号，用逗号分隔，例如: "1,3,5"。如果不相关，请返回"无"。`;

    // 调用LLM选择相关文档
    console.log(`🔍 [RAG查询] 请求LLM选择相关文档`);

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

    console.log(`✅ [RAG查询] LLM选择结果: ${selectedDocIdsStr}`);

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
    } else {
      // 如果LLM返回"无"或空，选择前3个文档
      selectedDocuments = allDocuments.slice(
        0,
        Math.min(3, allDocuments.length),
      );
    }

    console.log(`✅ [RAG查询] 选中 ${selectedDocuments.length} 个文档`);

    if (selectedDocuments.length === 0) {
      return [
        {
          name: "RAG知识库查询结果",
          description: `查询: ${query} (0 个结果)`,
          content: `# RAG知识库查询结果

**查询内容:** ${query}

## 查询结果

未找到与查询相关的内容。

`,
        },
      ];
    }

    // 第二步：获取选中文档的详细内容
    const detailedDocuments = await Promise.all(
      selectedDocuments.map(async (doc) => {
        try {
          const viewParams = {
            appId: orgId,
            documentId: doc.id,
          };
          return await knowledgeApi.viewDocument(viewParams);
        } catch (error) {
          console.warn(
            `⚠️ [RAG查询] 获取文档 ${doc.fileName} 详情时出错:`,
            error,
          );
          return null;
        }
      }),
    );

    // 过滤掉获取失败的文档
    const validDocuments = detailedDocuments.filter((doc) => doc !== null);

    // 处理文档内容，如果文档过大则进行切割并交给LLM处理
    const processedResults = await Promise.all(
      validDocuments.map(async (doc) => {
        // 检查文档大小，如果超过阈值则进行切割
        const CHUNK_SIZE = 8000; // 每个片段最大8000字符
        const content = doc!.content;

        if (content.length <= CHUNK_SIZE) {
          // 文档较小，直接处理
          const summary = await processDocumentWithLLM(
            query,
            content,
            llmToUse,
          );
          return {
            content: summary,
            source: doc!.fileName || "未知来源",
            metadata: {
              fileId: doc!.fileId,
              fileType: doc!.fileType,
              fileSize: doc!.fileSize,
              createTime: doc!.createTime,
              categoryId: doc!.categoryId,
              categoryName: doc!.categoryName,
            },
          };
        } else {
          // 文档较大，需要切割处理
          console.log(
            `🔍 [RAG查询] 文档 ${doc!.fileName} 较大 (${content.length} 字符)，需要切割处理`,
          );

          // 切割文档
          const chunks = splitDocumentIntoChunks(
            content,
            CHUNK_SIZE,
            doc!.fileName,
          );

          // 分别处理每个片段
          const chunkSummaries = await Promise.all(
            chunks.map(async (chunk) => {
              const summary = await processDocumentChunkWithLLM(
                query,
                chunk,
                llmToUse,
              );
              return summary;
            }),
          );

          // 合并所有片段的总结
          const combinedSummary = chunkSummaries.join("\n\n");

          // 如果合并后的内容仍然很长，再次总结
          let finalSummary = combinedSummary;
          if (combinedSummary.length > CHUNK_SIZE) {
            finalSummary = await processDocumentWithLLM(
              query,
              combinedSummary,
              llmToUse,
            );
          }

          return {
            content: finalSummary,
            source: doc!.fileName || "未知来源",
            metadata: {
              fileId: doc!.fileId,
              fileType: doc!.fileType,
              fileSize: doc!.fileSize,
              createTime: doc!.createTime,
              categoryId: doc!.categoryId,
              categoryName: doc!.categoryName,
            },
          };
        }
      }),
    );

    console.log(`✅ [RAG查询] 处理完成 ${processedResults.length} 个文档`);

    // 格式化返回结果
    return formatRagResults(query, { answer: "", results: processedResults });
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

  console.log(`✅ [RAG查询] 文档切割成 ${chunks.length} 个片段`);

  return chunks;
}

/**
 * 使用LLM处理整个文档
 */
async function processDocumentWithLLM(
  query: string,
  content: string,
  llm: any,
): Promise<string> {
  const prompt = `根据以下查询请求：

"${query}"

请分析并总结以下文档内容，提取与查询最相关的信息：

${content}

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
      return response.content
        .filter((part: any) => part.type === "text")
        .map((part: any) => part.text)
        .join("")
        .trim();
    }

    return "无法处理文档内容";
  } catch (error) {
    console.error("❌ [RAG查询] LLM处理文档时出错:", error);
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
  const prompt = `根据以下查询请求：

"${query}"

请分析以下文档片段，提取与查询最相关的信息。这是第${chunk.index + 1}/${chunk.total}个片段：

${chunk.content}

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
      return response.content
        .filter((part: any) => part.type === "text")
        .map((part: any) => part.text)
        .join("")
        .trim();
    }

    return "无法处理文档片段";
  } catch (error) {
    console.error(
      `❌ [RAG查询] LLM处理文档片段 ${chunk.index + 1}/${chunk.total} 时出错:`,
      error,
    );
    return `处理文档片段时出错: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * 解析流式响应文本
 */
function parseStreamResponse(responseText: string): RagApiResponse {
  const lines = responseText.split("\n").filter((line) => line.trim());
  let answer = "";
  const results: RagQueryResult[] = [];

  for (const line of lines) {
    try {
      const data = JSON.parse(line);
      if (data.answer) {
        answer += data.answer;
      }
      if (data.results && Array.isArray(data.results)) {
        results.push(...data.results);
      }
    } catch {
      // 忽略无法解析的行
      continue;
    }
  }

  return { answer, results };
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

/**
 * 格式化文档列表
 */
function formatDocumentList(documents: any[]) {
  let content = `# 知识库文档列表\n\n`;

  if (documents.length > 0) {
    content += `| 文件名 | 文件类型 | 文件大小 | 上传时间 | ID |\n`;
    content += `|--------|---------|---------|---------|----|\n`;

    documents.forEach((doc: any) => {
      content += `| ${doc.fileName || ""} | ${doc.fileType || ""} | ${doc.fileSize || 0} | ${doc.uploadTime || doc.createTime || ""} | ${doc.id} |\n`;
    });
  } else {
    content += "暂无文档\n";
  }

  return [
    {
      name: "知识库文档列表",
      description: `获取到 ${documents.length} 个文档`,
      content,
    },
  ];
}

/**
 * 格式化文档详情
 */
function formatDocumentDetail(document: any) {
  let content = `# 文档详情\n\n`;
  content += `**文件名:** ${document.fileName}\n\n`;
  content += `**文件类型:** ${document.fileType || "未知"}\n\n`;
  content += `**文件大小:** ${document.fileSize} 字节\n\n`;
  content += `**上传时间:** ${document.uploadTime || document.createTime}\n\n`;
  content += `**文档ID:** ${document.id}\n\n`;

  if (document.folderName) {
    content += `**文件夹:** ${document.folderName}\n\n`;
  }

  if (document.fileSummary) {
    content += `**摘要:** ${document.fileSummary}\n\n`;
  }

  content += `## 文档内容\n\n`;
  content += `${document.content}\n\n`;

  return [
    {
      name: `文档: ${document.fileName}`,
      description: `查看文档 "${document.fileName}" 的详细内容`,
      content,
    },
  ];
}
