import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";

import { PageHeader } from "@app/components/v2";

import { MemoriesSection } from "./components/MemoriesSection";
import { PersonasSection } from "./components/PersonasSection";
import { ProvidersSection } from "./components/ProvidersSection";

export const AIAssistantPage = () => {
  const { t } = useTranslation();

  return (
    <div className="h-full bg-background text-foreground">
      <Helmet>
        <title>{t("common.head-title", { title: "AI Assistant" })}</title>
      </Helmet>
      <div className="mx-auto mb-6 flex w-full max-w-8xl flex-col gap-6">
        <PageHeader
          scope="instance"
          title="AI Assistant"
          description="The models and personas behind the assistant in Vaultix. It works only with names and references, through each person's own permissions; secret values never reach it."
        />
        <ProvidersSection />
        <PersonasSection />
        <MemoriesSection />
      </div>
    </div>
  );
};
