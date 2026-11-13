import { createFileRoute, redirect } from "@tanstack/react-router";
import { addMinutes, formatISO } from "date-fns";

import { SessionStorageKeys } from "@app/const";
import { userKeys } from "@app/hooks/api";
import { fetchUserDetails } from "@app/hooks/api/users/queries";

import { parseHandoffRequest } from "./save-secret-handoff";
import { SaveSecretPage } from "./SaveSecretPage";

// The router re-encodes the query by its own rules ("+" stays a plus). The contract is read with
// URLSearchParams rules, so use the query this document was opened with; the partner always
// opens a new document and the way back after sign-in is a full page load.
const openedWith = { path: window.location.pathname, search: window.location.search };
const withoutTrailingSlash = (path: string) => (path.endsWith("/") ? path.slice(0, -1) : path);
const handoffSearch = (pathname: string, routerSearch: string) =>
  withoutTrailingSlash(openedWith.path) === withoutTrailingSlash(pathname)
    ? openedWith.search
    : routerSearch;

// Signing in may take a while: keep the way back for ten minutes (the URL carries no value).
const rememberReturn = (path: string) =>
  sessionStorage.setItem(
    SessionStorageKeys.ORG_LOGIN_SUCCESS_REDIRECT_URL,
    JSON.stringify({ expiry: formatISO(addMinutes(new Date(), 10)), data: path })
  );

export const Route = createFileRoute("/integrations/save-secret")({
  component: SaveSecretPage,
  beforeLoad: async ({ context, location }) => {
    const search = handoffSearch(location.pathname, location.searchStr);
    const handoff = parseHandoffRequest(
      search,
      context.serverConfig?.initialized ? (context.serverConfig.integrationOrigins ?? []) : []
    );
    if (!handoff.ok) return { handoff, organizationId: undefined, user: undefined };

    const returnPath = `${location.pathname}${search}`;
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
