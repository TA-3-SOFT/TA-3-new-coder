import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { PropsWithChildren, useEffect } from "react";
import { useAppSelector } from "../redux/hooks";

const CustomPostHogProvider = ({ children }: PropsWithChildren) => {
  const allowAnonymousTelemetry = useAppSelector(
    (store) => store?.config?.config?.allowAnonymousTelemetry,
  );

  useEffect(() => {
    // Telemetry permanently disabled
    posthog.opt_out_capturing();
  }, [allowAnonymousTelemetry]);

  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
};

export default CustomPostHogProvider;
