import { useContext, useState } from "react";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppSelector } from "../../redux/hooks";
import IndexingProgress from "./IndexingProgress";

export function IndexingSettingsSection() {
  const config = useAppSelector((state) => state.config.config);
  const ideMessenger = useContext(IdeMessengerContext);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleInitializeProjectInfo = async () => {
    if (isGenerating) return; // 防止重复点击

    setIsGenerating(true);
    try {
      await ideMessenger.request("project/initializeInfo", undefined);
    } catch (error) {
      console.error("项目信息初始化失败:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="py-5">
      <div>
        <h3 className="mx-auto mb-1 mt-0 text-xl">@codebase 索引</h3>
        <span className="text-lightgray w-3/4 text-xs">
          当前代码库的本地嵌入向量
        </span>
      </div>
      {config.disableIndexing ? (
        <div className="pb-2 pt-5">
          <p className="py-1 text-center font-semibold">索引功能已禁用</p>
          <p className="text-lightgray cursor-pointer text-center text-xs">
            打开设置并切换 <code>启用代码索引</code> 重新开启
          </p>
        </div>
      ) : (
        <IndexingProgress />
      )}

      {/* 项目信息初始化按钮 */}
      <div className="mt-6 border-t border-gray-300 pt-4">
        <div className="mb-2">
          <h4 className="text-lg font-medium">🧠 AI 项目分析</h4>
          <span className="text-lightgray text-xs">
            基于 AI 的智能项目分析和新手指南生成
          </span>
        </div>
        <button
          onClick={handleInitializeProjectInfo}
          disabled={isGenerating}
          className={` ${
            isGenerating
              ? "cursor-not-allowed bg-gray-400"
              : "bg-vsc-button-background hover:bg-vsc-button-background-hover"
          } text-vsc-button-foreground border-vsc-button-border flex items-center gap-2 rounded border px-4 py-2 text-sm font-medium transition-colors duration-200`}
        >
          {isGenerating ? (
            <>
              <div className="border-vsc-button-foreground h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"></div>
              正在生成项目分析...
            </>
          ) : (
            <>🚀 生成 AI 项目分析文档</>
          )}
        </button>
        <div className="text-lightgray mt-2 space-y-1 text-xs">
          {isGenerating ? (
            <div className="space-y-2">
              <p className="font-medium text-blue-400">
                🔄 正在进行项目分析，请稍候...
              </p>
              <div className="space-y-1 text-xs">
                <p>• 🔍 分析项目结构和依赖关系</p>
                <p>• 📊 识别技术栈和框架</p>
                <p>• 🧠 AI 深度分析项目架构</p>
                <p>• 📝 生成项目文档</p>
              </div>
              <p className="text-yellow-400">
                ⏱️ 分析过程可能需要几秒到几分钟，取决于项目大小和 AI
                模型响应速度
              </p>
            </div>
          ) : (
            <>
              <p>
                <strong>智能分析功能：</strong>
              </p>
              <ul className="ml-2 list-inside list-disc space-y-0.5">
                <li>📊 项目架构和技术栈深度分析</li>
                <li>📁 自动识别项目结构和依赖关系</li>
                <li>📖 整合 README 和配置文件信息</li>
              </ul>
              <p className="mt-2">
                生成的 <code>new-coder.md</code>{" "}
                文件将包含完整的项目分析报告，帮助新开发者快速理解项目
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
