import { useMemo } from "react";
import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";

import { PageHeader } from "@app/components/v2";
import {
  MCPL_ACTIONS,
  type McplAction,
  resolveMcplActions
} from "@app/components/vaultix/mcpl-manifest";
import { MCPLWorkbench } from "@app/components/vaultix/MCPLWorkbench";
import { useProviderImportRuntime } from "@app/components/vaultix/use-provider-import-runtime";
import { useOrganization } from "@app/context";

// Where each action really goes on this instance. Anything absent renders disabled.
const ACTION_DESTINATIONS: Partial<
  Record<string, "landing" | "connections" | "projects" | "audit" | "sso">
> = {
  "vaultix.ui.public.help.rehearsal": "landing",
  "vaultix.ui.auth.keys.manage": "connections",
  "vaultix.ui.identity.session.policy": "sso",
  "vaultix.ui.connect.doppler.import": "connections",
  "vaultix.ui.connect.external-vaultix.import": "connections",
  "vaultix.ui.secrets.reference.load": "projects",
  "vaultix.ui.operate.audits.review": "audit"
};

export const MCPLWorkbenchPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { currentOrg } = useOrganization();
  const { runtime, cards, isLoading, loadError } = useProviderImportRuntime();

  const actions = useMemo(() => resolveMcplActions(MCPL_ACTIONS, runtime), [runtime]);

  const goTo = (destination: NonNullable<(typeof ACTION_DESTINATIONS)[string]>) => {
    const params = { orgId: currentOrg.id };
    if (destination === "landing") navigate({ to: "/" });
    else if (destination === "connections")
      navigate({ to: "/organizations/$orgId/app-connections", params });
    else if (destination === "projects") navigate({ to: "/organizations/$orgId/projects", params });
    else if (destination === "audit") navigate({ to: "/organizations/$orgId/audit-logs", params });
    else navigate({ to: "/organizations/$orgId/sso", params });
  };

  return (
    <div className="h-full bg-background text-foreground">
      <Helmet>
        <title>{t("common.head-title", { title: "MCPL Workbench" })}</title>
      </Helmet>
      <div className="mx-auto flex flex-col justify-between">
        <div className="mx-auto mb-6 w-full max-w-8xl">
          <PageHeader
            scope="instance"
            title="MCPL Workbench"
            description="Scripted actions and import providers, with status from this instance's real connections."
          />
          <MCPLWorkbench
            actions={actions}
            providerCards={cards}
            isProvidersLoading={isLoading}
            providersError={loadError}
            canRunAction={(action: McplAction) => Boolean(ACTION_DESTINATIONS[action.id])}
            onAction={(action: McplAction) => {
              const destination = ACTION_DESTINATIONS[action.id];
              if (destination) goTo(destination);
            }}
            onConnect={() => goTo("connections")}
          />
        </div>
      </div>
    </div>
  );
};
