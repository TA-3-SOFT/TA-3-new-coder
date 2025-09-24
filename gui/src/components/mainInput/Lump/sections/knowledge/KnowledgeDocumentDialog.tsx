import { useContext, useEffect, useState } from "react";
import { IdeMessengerContext } from "../../../../../context/IdeMessenger";
import {
  useKnowledgeApi,
  KnowledgeDocumentDetail,
} from "../../../../../services/knowledgeApi";
import { fontSize } from "../../../../../util";
import {
  SecondaryButton,
  vscBackground,
  vscInputBackground,
  vscForeground,
} from "../../../..";

interface KnowledgeDocumentDialogProps {
  documentId: string;
  appId: string;
  closeDialog: () => void;
}

function KnowledgeDocumentDialog({
  documentId,
  appId,
  closeDialog,
}: KnowledgeDocumentDialogProps) {
  const ideMessenger = useContext(IdeMessengerContext);
  const knowledgeApi = useKnowledgeApi(); // 使用新的hook获取API服务
  const [document, setDocument] = useState<KnowledgeDocumentDetail | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDocumentDetail = async () => {
      try {
        setLoading(true);
        setError(null);

        const documentDetail = await knowledgeApi.viewDocument({
          appId,
          documentId,
        });

        setDocument(documentDetail);
      } catch (err) {
        console.error("Failed to fetch document detail:", err);
        setError(err instanceof Error ? err.message : "获取文档详情失败");
      } finally {
        setLoading(false);
      }
    };

    fetchDocumentDetail();
  }, [documentId, appId]);

  const handleOpenAsVirtualFile = () => {
    if (document) {
      ideMessenger.ide.showVirtualFile(document.fileName, document.content);
      closeDialog();
    }
  };

  return (
    <div className="max-w-2xl px-3 py-3">
      <h3 className="m-0 mb-3" style={{ fontSize: fontSize(-1) }}>
        知识库文档详情
      </h3>

      {loading && (
        <div className="flex items-center justify-center py-4">
          <div className="text-gray-500" style={{ fontSize: fontSize(-2) }}>
            加载中...
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center justify-center py-4">
          <div className="text-red-500" style={{ fontSize: fontSize(-2) }}>
            {error}
          </div>
        </div>
      )}

      {document && (
        <div className="flex flex-col gap-3">
          {/* 文档基本信息 */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h4 className="m-0 font-medium" style={{ fontSize: fontSize(0) }}>
                {document.fileName}
              </h4>
              <div className="flex gap-1">
                <SecondaryButton
                  onClick={handleOpenAsVirtualFile}
                  style={{
                    padding: "4px 8px",
                    margin: "0",
                    fontSize: fontSize(-3),
                  }}
                >
                  在编辑器中打开
                </SecondaryButton>
              </div>
            </div>

            <div
              className="flex flex-wrap gap-3 text-gray-500"
              style={{ fontSize: fontSize(-3) }}
            >
              {document.categoryName && (
                <span>分类: {document.categoryName}</span>
              )}
              <span>大小: {(document.fileSize / 1024).toFixed(1)} KB</span>
              {/*<span>创建时间: {new Date(document.createTime).toLocaleDateString()}</span>*/}
            </div>
          </div>

          {/* 文档内容 */}
          <div className="flex flex-col gap-2">
            <h5 className="m-0 font-medium" style={{ fontSize: fontSize(-1) }}>
              文档内容
            </h5>
            <div
              className="max-h-[300px] overflow-y-auto rounded-md border p-2"
              style={{
                fontSize: fontSize(-2),
                backgroundColor: vscInputBackground,
                borderColor: vscBackground,
                color: vscForeground,
              }}
            >
              <pre
                className="m-0 whitespace-pre-wrap font-mono"
                style={{
                  fontSize: fontSize(-2),
                  color: vscForeground,
                }}
              >
                {document.content}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default KnowledgeDocumentDialog;
