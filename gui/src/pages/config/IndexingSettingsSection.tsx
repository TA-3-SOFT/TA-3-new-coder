import { useAppSelector } from "../../redux/hooks";
import IndexingProgress from "./IndexingProgress";

export function IndexingSettingsSection() {
  const config = useAppSelector((state) => state.config.config);
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
    </div>
  );
}
