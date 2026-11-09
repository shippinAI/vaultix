import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";

import { PageHeader } from "@app/components/v2";
import { MCPLWorkbench } from "@app/components/vaultix/MCPLWorkbench";

export const MCPLWorkbenchPage = () => {
  const { t } = useTranslation();

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
            description="Schema-driven workflow runtime for providers, imports, AI actions, and secure approvals."
          />
          <MCPLWorkbench />
        </div>
      </div>
    </div>
  );
};
