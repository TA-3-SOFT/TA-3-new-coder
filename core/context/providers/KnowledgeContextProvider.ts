import { BaseContextProvider } from "../";
import {
  ContextItem,
  ContextProviderDescription,
  ContextProviderExtras,
} from "../../";
import {
  KnowledgeApiService,
  KnowledgeDocument,
  KnowledgeDocumentDetail,
  ListDocumentsParams,
  ViewDocumentParams,
  getKnowledgeApiServiceWithAuth,
} from "../../util/knowledgeApiService";

// 定义文档片段接口
interface DocumentChunk {
  content: string;
  source: string;
  index: number;
  total: number;
  metadata?: Record<string, any>;
}

class KnowledgeContextProvider extends BaseContextProvider {
  static description: ContextProviderDescription = {
    title: "knowledge",
    displayTitle: "知识库",
    description: "从知识库中检索相关文档",
    type: "normal",
  };

  private async getKnowledgeApiService(
    extras: ContextProviderExtras,
  ): Promise<KnowledgeApiService> {
    return getKnowledgeApiServiceWithAuth(extras.config.controlPlaneClient);
  }

  private async listDocuments(
    orgId: string,
    extras: ContextProviderExtras,
  ): Promise<KnowledgeDocument[]> {
    const knowledgeApiService = await this.getKnowledgeApiService(extras);
    const params: ListDocumentsParams = {
      appId: orgId,
    };
    return await knowledgeApiService.listDocuments(params);
  }

  private async viewDocument(
    documentId: string,
    orgId: string,
    extras: ContextProviderExtras,
  ): Promise<KnowledgeDocumentDetail> {
    const knowledgeApiService = await this.getKnowledgeApiService(extras);
    const params: ViewDocumentParams = {
      appId: orgId,
      documentId: documentId,
    };
    return await knowledgeApiService.viewDocument(params);
  }

  private async selectRelevantDocuments(
    documents: KnowledgeDocument[],
    query: string,
    extras: ContextProviderExtras,
  ): Promise<KnowledgeDocument[]> {
    if (documents.length === 0) {
      return [];
    }

    // 构建文档列表的描述
    const documentList = documents
      .map(
        (doc, index) =>
          `${index + 1}. 文件名: ${doc.fileName}, 分类: ${doc.categoryName || "无"}, 创建时间: ${doc.createTime}`,
      )
      .join("\n");

    const prompt = `请根据用户查询选择最相关的文档。

用户查询: ${query}

可选文档列表:
${documentList}

请从上述文档中选择最多5个与用户查询最相关的文档，返回它们的序号（用逗号分隔）。
如果没有相关文档，请返回"无"。

示例回答格式: 1,3,5 或 无`;

    try {
      // 使用当前选择的模型进行文档选择
      const llm = await extras.config.selectedModelByRole.longcontext?.complete(
        prompt,
        new AbortController().signal,
      );
      const response = llm ? llm.trim() : "";

      if (response === "无" || response.toLowerCase() === "none") {
        return [];
      }

      // 解析选择的文档序号
      const selectedIndices = response
        .split(",")
        .map((s) => parseInt(s.trim()) - 1)
        .filter((i) => i >= 0 && i < documents.length);

      return selectedIndices.map((i) => documents[i]);
    } catch (error) {
      console.error("Error selecting relevant documents:", error);
      // 如果模型选择失败，返回前5个文档作为备选
      return documents.slice(0, 5);
    }
  }

  /**
   * 将文档切割成多个片段
   */
  private splitDocumentIntoChunks(
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

    console.log(`✅ [知识库] 文档切割成 ${chunks.length} 个片段`);

    return chunks;
  }

  /**
   * 使用LLM处理文档片段
   */
  private async processDocumentChunkWithLLM(
    query: string,
    chunk: DocumentChunk,
    extras: ContextProviderExtras,
  ): Promise<string> {
    const prompt = `请从以下文档片段中提取与用户查询相关的知识片段。

用户查询: ${query}

文档片段 (第${chunk.index + 1}/${chunk.total}个片段):
${chunk.content}

请提取与查询最相关的内容片段，保持原文的准确性，并确保提取的内容完整且有意义。
如果该片段中没有相关内容，请返回"该片段中未找到相关内容"。`;

    try {
      const llm = await extras.config.selectedModelByRole.longcontext?.complete(
        prompt,
        new AbortController().signal,
      );
      return llm ? llm.trim() : "";
    } catch (error) {
      console.error(
        `Error processing document chunk ${chunk.index + 1}/${chunk.total}:`,
        error,
      );
      return `处理文档片段时出错: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * 使用LLM处理整个文档
   */
  private async processDocumentWithLLM(
    query: string,
    content: string,
    extras: ContextProviderExtras,
  ): Promise<string> {
    const prompt = `请从以下文档内容中提取与用户查询相关的知识片段。

用户查询: ${query}

文档内容:
${content}

请提取与查询最相关的内容片段，保持原文的准确性，并确保提取的内容完整且有意义。
如果文档中没有相关内容，请返回"该文档中未找到相关内容"。`;

    try {
      const llm = await extras.config.selectedModelByRole.longcontext?.complete(
        prompt,
        new AbortController().signal,
      );
      return llm ? llm.trim() : "";
    } catch (error) {
      console.error("Error processing document:", error);
      return `处理文档时出错: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async extractRelevantContent(
    document: KnowledgeDocumentDetail,
    query: string,
    extras: ContextProviderExtras,
  ): Promise<string> {
    const content = document.content;
    const CHUNK_SIZE = 400000; // 每个片段最大400000字符，与ragKnowledgeQuery保持一致

    if (content.length <= CHUNK_SIZE) {
      // 文档较小，直接处理
      console.log(`🔍 [知识库] 文档 ${document.fileName} 较小，直接处理`);
      return await this.processDocumentWithLLM(query, content, extras);
    } else {
      // 文档较大，需要切割处理
      console.log(
        `🔍 [知识库] 文档 ${document.fileName} 较大 (${content.length} 字符)，需要切割处理`,
      );

      // 切割文档
      const chunks = this.splitDocumentIntoChunks(
        content,
        CHUNK_SIZE,
        document.fileName || "未知文档",
      );

      // 分别处理每个片段
      const chunkSummaries = [];
      for (const chunk of chunks) {
        const summary = await this.processDocumentChunkWithLLM(
          query,
          chunk,
          extras,
        );
        // 只保留有相关内容的片段
        if (summary && !summary.includes("该片段中未找到相关内容")) {
          chunkSummaries.push(summary);
        }
      }

      // 如果没有找到相关内容
      if (chunkSummaries.length === 0) {
        return "该文档中未找到相关内容";
      }

      // 合并所有片段的总结
      const combinedSummary = chunkSummaries.join("\n\n");

      // 如果合并后的内容仍然很长，再次总结
      if (combinedSummary.length > CHUNK_SIZE) {
        console.log(`🔍 [知识库] 合并后内容仍然较长，进行二次总结`);
        return await this.processDocumentWithLLM(
          query,
          combinedSummary,
          extras,
        );
      }

      return combinedSummary;
    }
  }

  async getContextItems(
    query: string,
    extras: ContextProviderExtras,
  ): Promise<ContextItem[]> {
    try {
      const orgId = extras.config.selectedOrgId;
      // const orgId = "1cb76ad6656c415d87616b5a421668f1";
      // const orgId = "40FC1A880000456184F8E98396A1645F";
      if (!orgId) {
        return [
          {
            icon: "problems",
            name: "无应用",
            description: "未获取到应用标识",
            content: "未获取到应用标识",
          },
        ];
      }

      // 对于normal类型的provider，实际的查询内容在extras.fullInput中
      const searchQuery = extras.fullInput.split("知识库")[1] || query;
      console.log("Knowledge provider debug:", {
        query,
        fullInput: extras.fullInput,
        searchQuery,
      });

      // 如果没有查询内容，返回提示信息
      if (!searchQuery || searchQuery.trim() === "") {
        return [
          {
            name: "知识库",
            description: "请在@知识库后面输入您要搜索的内容",
            content: "使用方式：@知识库 您的问题或关键词",
          },
        ];
      }

      // 1. 获取知识库文档列表
      const documents = await this.listDocuments(orgId, extras);

      if (documents.length === 0) {
        return [
          {
            icon: "problems",
            name: "无文档",
            description: "知识库中没有文档",
            content: "知识库中暂无文档，请先上传相关文档。",
          },
        ];
      }

      // 2. 使用longtext模型选择相关文档
      const relevantDocuments = await this.selectRelevantDocuments(
        documents,
        searchQuery.trim(),
        extras,
      );

      if (relevantDocuments.length === 0) {
        return [
          {
            icon: "problems",
            name: "无相关文档",
            description: "未找到相关的知识库文档",
            content: `没有找到与"${searchQuery.trim()}"相关的知识库文档，请尝试其他关键词。`,
          },
        ];
      }

      // 3. 获取相关文档的详细内容并提取相关片段
      const contextItems: ContextItem[] = [];

      for (const doc of relevantDocuments) {
        try {
          const documentDetail = await this.viewDocument(doc.id, orgId, extras);
          const relevantContent = await this.extractRelevantContent(
            documentDetail,
            searchQuery.trim(),
            extras,
          );

          if (relevantContent !== "该文档中未找到相关内容") {
            contextItems.push({
              icon: "docs",
              name: "[" + doc.fileName + "].md",
              // name: "doc.txt",
              description: `知识库文档 - ${doc.categoryName || "无分类"}`,
              content: relevantContent,
            });
          }
        } catch (error) {
          console.error(`Error processing document ${doc.id}:`, error);
          // 继续处理其他文档
        }
      }

      if (contextItems.length === 0) {
        return [
          {
            icon: "problems",
            name: "无相关内容",
            description: "文档中未找到相关内容",
            content: `在相关文档中未找到与"${searchQuery.trim()}"相关的具体内容。`,
          },
        ];
      }

      return contextItems;
    } catch (error) {
      console.error("Knowledge context provider error:", error);
      return [
        {
          icon: "problems",
          name: "错误",
          description: "知识库查询失败",
          content: `错误: ${error instanceof Error ? error.message : "未知错误"}`,
        },
      ];
    }
  }
}

export default KnowledgeContextProvider;
