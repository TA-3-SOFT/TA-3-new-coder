import { BaseContextProvider } from "../";
import {
  ContextItem,
  ContextProviderDescription,
  ContextProviderExtras,
} from "../../";

interface KnowledgeDocument {
  id: string;
  fileName: string;
  fileSize: number;
  categoryName?: string;
  createTime: string;
  status: string;
}

interface KnowledgeDocumentDetail extends KnowledgeDocument {
  content: string;
  createUser: string;
}

interface KnowledgeSearchResult {
  id: string;
  contentId: string;
  contentType: string;
  title: string;
  content: string;
  score: number;
  categoryId: string;
  categoryName: string;
  tags: string[];
  sourceFileId: string;
  sourceFileName: string;
  createTime: string;
  updateTime: string;
  similarity: number;
}

interface KnowledgeApiResponse<T> {
  code: number;
  requestId: string;
  data: T;
  errors: string[];
  serviceSuccess: boolean;
  redirectUrl?: string;
}

class KnowledgeContextProvider extends BaseContextProvider {
  static description: ContextProviderDescription = {
    title: "knowledge",
    displayTitle: "知识库",
    description: "从知识库中检索相关文档",
    type: "normal",
  };

  private baseUrl = "http://192.168.20.195:8081/lowcodeback";

  private async getOrgId(extras: ContextProviderExtras): Promise<string> {
    // 优先使用options中配置的orgId
    if (this.options.orgId) {
      return this.options.orgId;
    }

    // 使用固定的orgId
    return "1cb76ad6656c415d87616b5a421668f1";
  }

  async getContextItems(
    query: string,
    extras: ContextProviderExtras,
  ): Promise<ContextItem[]> {
    try {
      const orgId = await this.getOrgId(extras);

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

      // 进行语义搜索
      const response = await extras.fetch(
        `${this.baseUrl}/api/knowledge/external/search/semantic`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            appId: orgId,
            query: searchQuery.trim(),
            topK: "10",
            minSimilarity: "0.6",
            useRerank: "true",
          }).toString(),
        },
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.serviceSuccess && data.code === 200) {
        const results = data.data.searchResults || [];

        if (results.length === 0) {
          return [
            {
              icon: "problems",
              name: "无搜索结果",
              description: "未找到相关的知识库内容",
              content: `没有找到与"${searchQuery.trim()}"相关的知识库内容，请尝试其他关键词。`,
            },
          ];
        }

        return results.map((result: KnowledgeSearchResult) => ({
          icon: "docs",
          name: result.title,
          description: `知识库搜索结果 (相似度: ${(result.similarity * 100).toFixed(1)}%)`,
          content: result.content,
        }));
      } else {
        throw new Error(data.errors?.join(", ") || "搜索失败");
      }
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
