// 知识库API服务

import { useContext } from "react";
import { IIdeMessenger, IdeMessengerContext } from "../context/IdeMessenger";

export interface KnowledgeDocument {
  id: string;
  documentId?: string;
  fileName: string;
  fileSize: number;
  fileId: string;
  fileType?: string;
  categoryId: string;
  categoryName?: string;
  folderId?: string;
  folderName?: string;
  uploadTime?: string;
  createTime: string;
  status: string;
  uploadUser?: string;
  fileSummary?: string;
}

export interface KnowledgeDocumentDetail extends KnowledgeDocument {
  content: string;
  createUser: string;
}

export interface KnowledgeSearchResult {
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
}

export interface KnowledgeApiResponse<T> {
  code: number;
  requestId: string;
  data: T;
  errors: string[];
  serviceSuccess: boolean;
  redirectUrl?: string;
}

export interface ListDocumentsParams {
  appId: string;
  folderId?: string;
  fileName?: string;
}

export interface ViewDocumentParams {
  appId: string;
  documentId: string;
}

export interface SearchKnowledgeParams {
  appId: string;
  query: string;
  topK?: number;
  minSimilarity?: number;
  useRerank?: boolean;
}

class KnowledgeApiService {
  constructor(private ideMessenger: IIdeMessenger) {}

  /**
   * 获取应用下所有文档列表
   */
  async listDocuments(
    params: ListDocumentsParams,
  ): Promise<KnowledgeDocument[]> {
    try {
      const result = await this.ideMessenger.request(
        "knowledge/listDocuments",
        params,
      );
      if (result.status === "success") {
        return result.content;
      } else {
        throw new Error("查询知识库列表失败");
      }
    } catch (error) {
      console.error("Failed to list documents:", error);
      throw error;
    }
  }

  /**
   * 查看文档详情
   */
  async viewDocument(
    params: ViewDocumentParams,
  ): Promise<KnowledgeDocumentDetail> {
    try {
      const result = await this.ideMessenger.request(
        "knowledge/viewDocument",
        params,
      );
      if (result.status === "success") {
        return result.content;
      } else {
        throw new Error("获取知识库详情失败");
      }
    } catch (error) {
      console.error("Failed to view document:", error);
      throw error;
    }
  }

  /**
   * 语义搜索
   */
  async searchKnowledge(
    params: SearchKnowledgeParams,
  ): Promise<KnowledgeSearchResult[]> {
    try {
      const searchParams = {
        ...params,
        topK: params.topK || 10,
        minSimilarity: params.minSimilarity || 0.6,
        useRerank: params.useRerank !== false, // 默认为true
      };

      const result = await this.ideMessenger.request(
        "knowledge/searchKnowledge",
        searchParams,
      );
      if (result.status === "success") {
        return result.content;
      } else {
        throw new Error("检索知识库失败");
      }
    } catch (error) {
      console.error("Failed to search knowledge:", error);
      throw error;
    }
  }
}

// 创建知识库API服务实例的工厂函数
// React Hook 用于在组件中使用知识库API服务
export function useKnowledgeApi(): KnowledgeApiService {
  const ideMessenger = useContext(IdeMessengerContext);
  return new KnowledgeApiService(ideMessenger);
}
