import {
  ArrowTopRightOnSquareIcon,
  DocumentArrowUpIcon,
  PaintBrushIcon,
  TableCellsIcon,
} from "@heroicons/react/24/outline";
import { useContext } from "react";
import { useNavigate } from "react-router-dom";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppDispatch } from "../../redux/hooks";
import { setOnboardingCard } from "../../redux/slices/uiSlice";
import { saveCurrentSession } from "../../redux/thunks/session";
import { ROUTES } from "../../util/navigation";
import MoreHelpRow from "./MoreHelpRow";

export function HelpCenterSection() {
  const ideMessenger = useContext(IdeMessengerContext);
  const navigate = useNavigate();
  const dispatch = useAppDispatch();

  return (
    <div className="py-5">
      <h3 className="mb-4 mt-0 text-xl">帮助中心</h3>
      <div className="-mx-4 flex flex-col">
        <MoreHelpRow
          title="快速开始"
          description="学习如何使用TA+3 牛码"
          Icon={ArrowTopRightOnSquareIcon}
          onClick={() =>
            ideMessenger.post(
              "openUrl",
              "http://172.20.23.216/ta3-ai-doc/docs/docs/code/README.html",
            )
          }
        />

        {/*        <MoreHelpRow
          title="Have an issue?"
          description="Let us know on GitHub and we'll do our best to resolve it"
          Icon={ArrowTopRightOnSquareIcon}
          onClick={() =>
            ideMessenger.post(
              "openUrl",
              "https://github.com/continuedev/continue/issues/new/choose",
            )
          }
        />*/}

        {/*        <MoreHelpRow
          title="Join the community!"
          description="Join us on Discord to stay up-to-date on the latest developments"
          Icon={ArrowTopRightOnSquareIcon}
          onClick={() =>
            ideMessenger.post("openUrl", "https://discord.gg/vapESyrFmJ")
          }
        />*/}

        <MoreHelpRow
          title="Token 使用情况"
          description="模型每日Token使用情况"
          Icon={TableCellsIcon}
          onClick={() => navigate("/stats")}
        />

        {/*<MoreHelpRow
          title="Quickstart"
          description="Reopen the quickstart and tutorial file"
          Icon={DocumentArrowUpIcon}
          onClick={async () => {
            navigate("/");
            // Used to clear the chat panel before showing onboarding card
            await dispatch(
              saveCurrentSession({
                openNewSession: true,
                generateTitle: true,
              }),
            );
            dispatch(setOnboardingCard({ show: true, activeTab: "Best" }));
            ideMessenger.post("showTutorial", undefined);
          }}
        />*/}

        <MoreHelpRow
          title="TA+3 AI 系列工具"
          description="了解TA+3 AI 系列工具的详细信息"
          Icon={ArrowTopRightOnSquareIcon}
          onClick={() =>
            ideMessenger.post(
              "openUrl",
              "http://172.20.23.216/ta3-ai-doc/README.html",
            )
          }
        />

        {/*        {process.env.NODE_ENV === "development" && (
          <MoreHelpRow
            title="Theme Test Page"
            description="Development page for testing themes"
            Icon={PaintBrushIcon}
            onClick={async () => {
              navigate(ROUTES.THEME);
            }}
          />
        )}*/}
      </div>
    </div>
  );
}
