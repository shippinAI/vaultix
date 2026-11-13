import { createFileRoute, redirect } from "@tanstack/react-router";
import { addMinutes, formatISO } from "date-fns";

import { SessionStorageKeys } from "@app/const";
import { userKeys } from "@app/hooks/api";
import { fetchUserDetails } from "@app/hooks/api/users/queries";

import { parseHandoffRequest } from "./save-secret-handoff";
import { SaveSecretPage } from "./SaveSecretPage";

// Signing in may take a while: keep the way back for ten minutes (the URL carries no value).
const rememberReturn = (path: string) =>
  sessionStorage.setItem(
    SessionStorageKeys.ORG_LOGIN_SUCCESS_REDIRECT_URL,
    JSON.stringify({ expiry: formatISO(addMinutes(new Date(), 10)), data: path })
  );

export const Route = createFileRoute("/integrations/save-secret")({
  component: SaveSecretPage,
  beforeLoad: async ({ context, location }) => {
    const handoff = parseHandoffRequest(
      location.searchStr,
      context.serverConfig?.initialized ? (context.serverConfig.integrationOrigins ?? []) : []
    );
    if (!handoff.ok) return { handoff, organizationId: undefined, user: undefined };

    const returnPath = `${location.pathname}${location.searchStr}`;
    if (!context.authToken) {
      rememberReturn(returnPath);
      throw redirect({ to: "/login" });
    }
    const organizationId = context.authToken.subOrganizationId || context.authToken.organizationId;
    if (!organizationId) {
      rememberReturn(returnPath);
      throw redirect({ to: "/login/select-organization" });
    }
    const user = await context.queryClient
      .ensureQueryData({ queryKey: userKeys.getUser, queryFn: fetchUserDetails })
      .catch(() => undefined);
    if (!user) {
      rememberReturn(returnPath);
      throw redirect({ to: "/login" });
    }
    return { handoff, organizationId, user };
  }
});
