import { UserCircleIcon } from "@heroicons/react/24/solid";

import { isOnPremSession } from "core/control-plane/AuthTypes";
import { useState } from "react";
import { SecondaryButton } from "../../components";
import {
  Popover,
  PopoverButton,
  PopoverPanel,
  Transition,
} from "../../components/ui";
import { useAuth } from "../../context/Auth";
import { ScopeSelect } from "./ScopeSelect";

export function AccountButton() {
  const { session, logout, login, organizations } = useAuth();
  const [ isLoggingIn, setIsLoggingIn ] = useState(false)

  if (isLoggingIn) {
    return '登录中...'
  }

  async function onLoginClick () {
    setIsLoggingIn(true)
    await login(false)
    setIsLoggingIn(false)
  }

  if (!session) {
    return (
      <SecondaryButton
        className="whitespace-nowrap"
        onClick={onLoginClick}
      >
        登录
      </SecondaryButton>
    );
  }

  // No login button for on-prem deployments
  if (isOnPremSession(session)) {
    return null;
  }

  return (
    <Popover className="relative">
      {({ close }) => (
        <>
          <PopoverButton className="bg-vsc-background hover:bg-vsc-input-background text-vsc-foreground my-0.5 flex cursor-pointer rounded-md border-none px-2">
            <div className="flex items-center gap-1.5">
              <span className="font-medium">
                {session.account.label}
              </span>
              <UserCircleIcon className="h-6 w-6" />{" "}
            </div>
          </PopoverButton>

          <Transition>
            <PopoverPanel className="bg-vsc-input-background xs:p-4 absolute right-0 mt-1 rounded-md border border-zinc-700 p-2 shadow-lg">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col">
                  <span className="font-medium">{session.account.label}</span>
                </div>

                {organizations.length > 0 && (
                  <div className="flex flex-col gap-1 text-xs">
                    <label className="text-vsc-foreground">
                      项目
                    </label>
                    <ScopeSelect onSelect={close} />
                  </div>
                )}

                <SecondaryButton onClick={logout} className="!mx-0 w-full">
                  登出
                </SecondaryButton>
              </div>
            </PopoverPanel>
          </Transition>
        </>
      )}
    </Popover>
  );
}
