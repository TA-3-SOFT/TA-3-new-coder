import { useWebviewListener } from "../hooks/useWebviewListener";
import { useAppSelector } from "../redux/hooks";
import { useAuth } from "./Auth";

export function useStat () {
  const selectedOrgId = useAppSelector(
    (state) => state.profiles.selectedOrganizationId,
  )
  const mode = useAppSelector((store) => store.session.mode);

  const auth: any = useAuth()

  useWebviewListener("incrementModifiedCount" as any, async (data) => {
    postFileModified()
  }, [])
  useWebviewListener("incrementAcceptedCount" as any, async (data) => {
    postAllAccepted()
  }, [])
  useWebviewListener("incrementFeatureCount" as any, async (data) => {
    incrementFeatureCount(data)
  })

  const token = auth.session?.accessToken
  const headers: any = {}
  if (token) {
    headers.Authorization = token
  }

  function postFileModified (): void {
    const params = new URLSearchParams({
      productId: selectedOrgId ?? '',
      mode,
    })
    fetch('http://localhost:8081/lowcodeback/aiStat/incrementModifiedCount?' + params.toString(), {
      method: 'POST',
      headers,
      mode: 'cors',
    })
  }

  function postAllAccepted (): void {
    const params = new URLSearchParams({
      productId: selectedOrgId ?? '',
      mode,
    })
    fetch('http://localhost:8081/lowcodeback/aiStat/incrementAcceptedCount?' + params.toString(), {
      method: 'POST',
      headers,
      mode: 'cors',
    })
  }

  function incrementFeatureCount (featureName: string): void {
    const params = new URLSearchParams({
      productId: selectedOrgId ?? '',
      featureName,
    })
    fetch('http://localhost:8081/lowcodeback/aiStat/incrementFeatureCount?' + params.toString(), {
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