import { useAppSelector } from "../../../../../redux/hooks";
import { selectActiveTools } from "../../../../../redux/selectors/selectActiveTools";

export const ToolsSectionTooltip = () => {
  const tools = useAppSelector((store) => store.config.config.tools);
  const activeTools = useAppSelector(selectActiveTools);

  const numTools = tools.length;
  const numActiveTools = activeTools.length;

  return (
    <div>
      <span>{`工具 (${numActiveTools}/${numTools} 激活)`}</span>
    </div>
  );
};
