import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { useEffect, useMemo, useState } from "react";
import { useAppDispatch, useAppSelector } from "../../../../../redux/hooks";
import {
  setDialogMessage,
  setShowDialog,
} from "../../../../../redux/slices/uiSlice";

import {
  KnowledgeDocument,
  useKnowledgeApi,
} from "../../../../../services/knowledgeApi";
import { fontSize } from "../../../../../util";

import KnowledgeDocumentDialog from "./KnowledgeDocumentDialog";

function KnowledgeDocumentItem({
  document,
  onDocumentClick,
}: {
  document: KnowledgeDocument;
  onDocumentClick: (document: KnowledgeDocument) => void;
}) {
  return (
    <div className="mt-1 flex w-full flex-col">
      <div className="flex min-w-0 flex-row items-center justify-between gap-2 text-sm">
        <div
          className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0"
          onClick={() => onDocumentClick(document)}
        >
          <p
            style={{
              fontSize: fontSize(-3),
            }}
            className="m-0 line-clamp-1 truncate p-0 text-left hover:underline"
          >
            {document.fileName}
          </p>
          {document.categoryName && (
            <p
              style={{
                fontSize: fontSize(-4),
              }}
              className="m-0 truncate p-0 text-left text-gray-500"
            >
              {document.categoryName}
            </p>
          )}
        </div>

        <div className="flex flex-shrink-0 flex-row items-center gap-2 text-gray-400">
          <span
            className="whitespace-nowrap text-xs"
            style={{
              fontSize: fontSize(-3),
            }}
          >
            {(document.fileSize / 1024).toFixed(1)}KB
          </span>

          <span
            className="whitespace-nowrap text-xs"
            style={{
              fontSize: fontSize(-3),
            }}
          >
            {new Date(document.createTime).toLocaleDateString()}
          </span>
        </div>
      </div>
    </div>
  );
}

function KnowledgeSection() {
  const selectedOrgId = useAppSelector(
    (state) => state.profiles.selectedOrganizationId,
  );
  const dispatch = useAppDispatch();
  const knowledgeApi = useKnowledgeApi(); // 使用新的hook获取API服务

  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // 获取知识库文档列表
  const fetchDocuments = async () => {
    if (!selectedOrgId) {
      setError("请先选择组织");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = {
        appId: selectedOrgId,
        // appId: "1cb76ad6656c415d87616b5a421668f1",
      };

      const documents = await knowledgeApi.listDocuments(params);
      setDocuments(documents);
    } catch (err) {
      console.error("Failed to fetch knowledge documents:", err);
      setError(err instanceof Error ? err.message : "网络请求失败，请检查连接");
    } finally {
      setLoading(false);
    }
  };

  // 当组织ID变化时重新获取文档
  useEffect(() => {
    fetchDocuments();
  }, [selectedOrgId]);

  // 移除搜索时的API调用，改为纯前端过滤

  const filteredDocuments = useMemo(() => {
    if (!searchQuery.trim()) return documents;

    const query = searchQuery.toLowerCase();
    return documents.filter(
      (doc) =>
        doc.fileName.toLowerCase().includes(query) ||
        doc.categoryName?.toLowerCase().includes(query),
    );
  }, [documents, searchQuery]);

  // 处理文档点击事件
  const handleDocumentClick = (document: KnowledgeDocument) => {
    if (!selectedOrgId) {
      setError("请先选择组织");
      return;
    }
    dispatch(
      setDialogMessage(
        <KnowledgeDocumentDialog
          documentId={document.id}
          appId={selectedOrgId}
          closeDialog={() => {
            dispatch(setShowDialog(false));
            dispatch(setDialogMessage(undefined));
          }}
        />,
      ),
    );
    dispatch(setShowDialog(true));
  };

  return (
    <div className="flex flex-col">
      {/* 搜索框 */}
      <div className="relative">
        <MagnifyingGlassIcon className="text-input-placeholder pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 transform" />
        <input
          type="text"
          placeholder="搜索知识库文档..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="bg-input text-input-foreground border-input-border placeholder-input-placeholder w-[calc(100%-40px)] rounded-md border pl-8 text-sm transition-colors focus:outline-none"
        />
      </div>

      {/* 文档列表 */}
      <div className="flex max-h-[170px] flex-col overflow-y-auto overflow-x-hidden">
        {loading && (
          <div className="flex items-center justify-center py-4">
            <div className="text-sm text-gray-500">加载中...</div>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center py-4">
            <div className="text-sm text-red-500">{error}</div>
          </div>
        )}

        {!loading && !error && filteredDocuments.length === 0 && (
          <div className="flex items-center justify-center py-4">
            <div className="text-sm text-gray-500">
              {searchQuery ? "未找到匹配的文档" : "暂无知识库文档"}
            </div>
          </div>
        )}

        {!loading &&
          !error &&
          filteredDocuments.map((document) => (
            <KnowledgeDocumentItem
              key={document.id}
              document={document}
              onDocumentClick={handleDocumentClick}
            />
          ))}
      </div>
    </div>
  );
}

export default KnowledgeSection;
