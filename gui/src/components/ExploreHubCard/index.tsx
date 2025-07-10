import { ChevronRightIcon } from "@heroicons/react/24/outline";
import { useContext } from "react";
import { Button, ButtonSubtext } from "..";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { setIsExploreDialogOpen } from "../../redux/slices/uiSlice";
import { LocalStorageKey, setLocalStorage } from "../../util/localStorage";
import { ReusableCard } from "../ReusableCard";

export function ExploreHubCard() {
  const dispatch = useAppDispatch();
  const isOpen = useAppSelector((state) => state.ui.isExploreDialogOpen);
  const ideMessenger = useContext(IdeMessengerContext);

  if (!isOpen) return null;

  return (
    <ReusableCard
      showCloseButton={true}
      onClose={() => {
        setLocalStorage(LocalStorageKey.IsExploreDialogOpen, false);
        setLocalStorage(LocalStorageKey.HasDismissedExploreDialog, true);
        return dispatch(setIsExploreDialogOpen(false));
      }}
    >
      <div className="flex flex-col items-center gap-1 px-4 text-center">
        <div className="mb-4">
          <h2 className="mb-1 text-xl font-semibold">快速开始</h2>

          <p className="text-lightgray my-0 max-w-lg text-sm font-light leading-relaxed">
            查看 TA+3 牛码 插件文档，了解操作指南
          </p>
        </div>

        <Button
          className="w-full"
          onClick={() => {
            ideMessenger.request("controlPlane/openUrl", {
              path: "http://172.20.23.216/ta3-ai-doc/docs/docs/code/README.html",
              orgSlug: undefined,
            });
          }}
        >
          打开文档
        </Button>

        <ButtonSubtext
          onClick={() => {
            ideMessenger.request("controlPlane/openUrl", {
              path: "http://172.20.23.216/ta3-ai-doc/README.html",
              orgSlug: undefined,
            });
          }}
        >
          <div className="flex cursor-pointer items-center justify-center gap-1">
            <span>或者了解其他 TA+3 AI 系列工具</span>
            <ChevronRightIcon className="h-3 w-3" />
          </div>
        </ButtonSubtext>
      </div>
    </ReusableCard>
  );
}
