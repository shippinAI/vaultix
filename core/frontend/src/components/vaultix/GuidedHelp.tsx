import type { ComponentProps } from "react";

import { useVaultixGuidance } from "@app/hooks/api/vaultix/guidance";

import { GuidanceHintView, GuidedHelpView } from "./GuidedHelpView";

export const GuidedHelp = (props: Omit<ComponentProps<typeof GuidedHelpView>, "query">) => {
  const query = useVaultixGuidance();
  return <GuidedHelpView {...props} query={query} />;
};
export const GuidanceHint = (props: Omit<ComponentProps<typeof GuidanceHintView>, "query">) => {
  const query = useVaultixGuidance();
  return <GuidanceHintView {...props} query={query} />;
};
