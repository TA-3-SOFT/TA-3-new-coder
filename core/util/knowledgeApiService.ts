import { fetchwithRequestOptions } from "@continuedev/fetch";
import { ControlPlaneClient } from "../control-plane/client.js";

// 知识库API相关类型定义
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

// 知识库API服务类
export class KnowledgeApiService {
  private static instance: KnowledgeApiService;
  private baseUrl = "http://192.168.20.195:8081/lowcodeback";
  private controlPlaneClient?: ControlPlaneClient;

  private constructor() {
    // 私有构造函数，防止外部直接实例化
  }

  // 获取单例实例
  public static getInstance(): KnowledgeApiService {
    if (!KnowledgeApiService.instance) {
      KnowledgeApiService.instance = new KnowledgeApiService();
    }
    return KnowledgeApiService.instance;
  }

  // 设置认证客户端
  public setControlPlaneClient(controlPlaneClient: ControlPlaneClient): void {
    this.controlPlaneClient = controlPlaneClient;
  }

  // 清除认证客户端
  private async makeRequest<T>(
    endpoint: string,
    params: any,
  ): Promise<KnowledgeApiResponse<T>> {
    const formData = new URLSearchParams();

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        formData.append(key, String(value));
      }
    });

    // 动态获取Authorization header
    let headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };

    if (this.controlPlaneClient) {
      try {
        headers = await this.controlPlaneClient.setAuthHeader(headers);
      } catch (error) {
        console.warn("Failed to get auth token, using fallback:", error);
      }
    }

    const response = await fetchwithRequestOptions(
      `${this.baseUrl}${endpoint}`,
      {
        method: "POST",
        headers,
        body: formData.toString(),
      },
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data as KnowledgeApiResponse<T>;
  }

  /**
   * 获取应用下所有文档列表
   */
  async listDocuments(
    params: ListDocumentsParams,
  ): Promise<KnowledgeDocument[]> {
    try {
      const response = await this.makeRequest<{
        documents: KnowledgeDocument[];
      }>("/api/knowledge/external/ide/document/listAll", params);

      if (response.serviceSuccess && response.code === 200) {
        return response.data.documents || [];
      } else {
        throw new Error(response.errors?.join(", ") || "获取文档列表失败");
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
      const response = await this.makeRequest<{
        documentDetail: KnowledgeDocumentDetail;
      }>("/api/knowledge/external/ide/document/view", params);

      if (response.serviceSuccess && response.code === 200) {
        return response.data.documentDetail;
      } else {
        throw new Error(response.errors?.join(", ") || "获取文档详情失败");
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

      const response = await this.makeRequest<{
        searchResults: KnowledgeSearchResult[];
      }>("/api/knowledge/external/ide/search/semantic", searchParams);

      if (response.serviceSuccess && response.code === 200) {
        return response.data.searchResults || [];
      } else {
        throw new Error(response.errors?.join(", ") || "搜索失败");
      }
    } catch (error) {
      console.error("Failed to search knowledge:", error);
      throw error;
    }
  }
}

// 便捷函数：设置认证客户端并返回单例实例
export function getKnowledgeApiServiceWithAuth(
  controlPlaneClient: ControlPlaneClient,
): KnowledgeApiService {
  const service = KnowledgeApiService.getInstance();
  service.setControlPlaneClient(controlPlaneClient);
  return service;
}
