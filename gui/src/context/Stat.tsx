import { useWebviewListener } from "../hooks/useWebviewListener"
import { useAppSelector } from "../redux/hooks"
import { useAuth } from "./Auth"

export function useStat () {
  const selectedOrgId = useAppSelector(
    (state) => state.profiles.selectedOrganizationId,
  )
  const auth: any = useAuth()

  useWebviewListener("incrementModifiedCount" as any, async (data) => {
    postFileModified()
  }, [])
  useWebviewListener("incrementAcceptedCount" as any, async (data) => {
    postAllAccepted()
  }, [])


  const token = auth.session?.accessToken
  const headers: any = {}
  if (token) {
    headers.Authorization = token
  }

  function postFileModified (): void {
    fetch('http://localhost:8081/lowcodeback/aiStat/incrementModifiedCount?productId=' + selectedOrgId, {
      method: 'POST',
      headers,
      mode: 'cors',
    })
  }

  function postAllAccepted (): void {
    fetch('http://localhost:8081/lowcodeback/aiStat/incrementAcceptedCount?productId=' + selectedOrgId, {
      method: 'POST',
      headers,
      mode: 'cors',
    })
  }

  return {
    postFileModified,
    postAllAccepted,
  }
}