import { useContext } from "react";
import { IdeMessengerContext } from "../../../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../../../redux/hooks";
import { exitEdit } from "../../../../redux/thunks/edit";
import AcceptRejectDiffButtons from "../../../AcceptRejectDiffButtons";
import { useMainEditor } from "../../TipTapEditor";

export function EditOutcomeToolbar() {
  const dispatch = useAppDispatch();
  const editApplyState = useAppSelector(
    (store) => store.editModeState.applyState,
  );
  const fullyAutomaticEditMode = useAppSelector(
    (state) => state.config.config.ui?.fullyAutomaticEditMode ?? false,
  );
  const { mainEditor } = useMainEditor();
  const ideMessenger = useContext(IdeMessengerContext);

  return (
    <div className="text-description-muted flex items-center justify-between py-0.5 text-xs">
      <div className="bg-badge rounded px-1.5">
        <span>{`${editApplyState.numDiffs} diff${editApplyState.numDiffs !== 1 ? "s" : ""}`}</span>
      </div>
      {fullyAutomaticEditMode ? (
        <div className="text-description-muted text-xs">
          <span>统一修改模式 - 已自动应用</span>
        </div>
      ) : (
        <AcceptRejectDiffButtons
          applyStates={[editApplyState]}
          onAcceptOrReject={async (outcome) => {
            if (outcome === "acceptDiff") {
              await dispatch(exitEdit({}));
              ideMessenger.post("focusEditor", undefined);
            } else {
              mainEditor?.commands.focus();
            }
          }}
        />
      )}
    </div>
  );
}
