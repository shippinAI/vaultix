import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";

import { PageHeader } from "@app/components/v2";

import { EarlyAccessRequestsTable } from "./components/EarlyAccessRequestsTable";
import { EarlyAccessSettings } from "./components/EarlyAccessSettings";

export const EarlyAccessPage = () => {
  const { t } = useTranslation();

  return (
    <div className="h-full bg-background text-foreground">
      <Helmet>
        <title>{t("common.head-title", { title: "Early Access" })}</title>
      </Helmet>
      <div className="mx-auto mb-6 flex w-full max-w-8xl flex-col gap-6">
        <PageHeader
          scope="instance"
          title="Early Access"
          description="Decide who can ask to join this instance, and review the people who have."
        />
        <EarlyAccessSettings />
        <EarlyAccessRequestsTable />
      </div>
    </div>
  );
};
