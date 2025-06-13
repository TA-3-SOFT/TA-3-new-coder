import { useAppSelector } from "../../../../../redux/hooks";

export const McpSectionTooltip = () => {
  const mcpServers = useAppSelector(
    (store) => store.config.config.mcpServerStatuses,
  );

  const numServers = mcpServers.length;
  const numActiveServers = mcpServers.filter(
    (server) => server.status === "connected",
  ).length;

  return (
    <div>
      <span>{`MCP 服务 (${numActiveServers}/${numServers} 激活)`}</span>
    </div>
  );
};
