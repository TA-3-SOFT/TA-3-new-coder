import {
  BuildingOfficeIcon,
  ChevronDownIcon,
} from "@heroicons/react/24/outline";
import { useContext } from "react";
import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from "../../../components/ui/Listbox";
import { useAuth } from "../../../context/Auth";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../../redux/hooks";
import {
  selectCurrentOrg,
  setSelectedOrgId,
} from "../../../redux/slices/profiles/slice";
import {
  fontSize,
} from "../../../util";
import { useLump } from "../../mainInput/Lump/LumpContext";

export default function OrgSelect () {
  const { organizations } = useAuth()
  const selectedOrgId = useAppSelector(
    (state) => state.profiles.selectedOrganizationId,
  )
  const currentOrg = useAppSelector(selectCurrentOrg)
  const ideMessenger = useContext(IdeMessengerContext);
  const dispatch = useAppDispatch()

  const { isToolbarExpanded } = useLump()

  const handleChange = (newValue: string) => {
    // optimisitic update
    dispatch(setSelectedOrgId(newValue))
    ideMessenger.post("didChangeSelectedOrg", {
      id: newValue,
    })
  }

  return <Listbox value={selectedOrgId} onChange={handleChange}>
    <div className="relative">
      <ListboxButton
        className="text-description border-none bg-transparent hover:brightness-125"
        style={{ fontSize: fontSize(-3) }}
      >
        <div className="flex flex-row items-center gap-1.5">
          <div className="h-3 w-3 flex-shrink-0 select-none">
            <BuildingOfficeIcon className="h-3 w-3" />
          </div>
          <span
            className={`line-clamp-1 select-none break-all ${isToolbarExpanded ? "xs:hidden sm:line-clamp-1" : ""}`}
          >
            {currentOrg?.name ?? '(未知)'}
          </span>
        </div>
        <ChevronDownIcon
          className="h-2 w-2 flex-shrink-0 select-none"
          aria-hidden="true"
        />
      </ListboxButton>

      <ListboxOptions className="z-[1000] min-w-[140px] pt-0.5 sm:min-w-[200px]">
        {organizations.map((org) => (
          <ListboxOption key={org.id} value={org.id} className="py-2">
            <div className="flex items-center gap-2">
              {org.iconUrl ? (
                <img src={org.iconUrl} alt="" className="h-5 w-5" />
              ) : (
                <BuildingOfficeIcon className="h-5 w-5" />
              )}
              <span>{org.name}</span>
            </div>
          </ListboxOption>
        ))}
      </ListboxOptions>
    </div>
  </Listbox>
}