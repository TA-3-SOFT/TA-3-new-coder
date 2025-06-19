import { History } from "../../components/History";
import StructuredAgentProgress from "../../components/StructuredAgentProgress/StructuredAgentProgress";
import { useAppSelector } from "../../redux/hooks";
import { Chat } from "./Chat";

export default function GUI() {
  const mode = useAppSelector((state) => state.session.mode);
  const structuredAgentWorkflow = useAppSelector(
    (state) => state.session.structuredAgentWorkflow
  );

  const showStructuredAgentProgress =
    mode === "structured-agent" && structuredAgentWorkflow.isActive;

  return (
    <div className="flex w-screen flex-row overflow-hidden">
      <aside className="4xl:flex border-vsc-input-border no-scrollbar hidden w-96 overflow-y-auto border-0 border-r border-solid">
        <History />
      </aside>
      <main className="no-scrollbar flex flex-1 flex-col overflow-y-auto">
        <Chat />
      </main>
      {showStructuredAgentProgress && (
        <aside className="border-vsc-input-border no-scrollbar w-20 overflow-y-auto border-0 border-l border-solid bg-gray-50">
          <StructuredAgentProgress />
        </aside>
      )}
    </div>
  );
}
