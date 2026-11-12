import { Helmet } from "react-helmet";

import { PageHeader } from "@app/components/v2";
import { useOrganization } from "@app/context";
import { OrgOauthClientsTab } from "@app/pages/organization/SettingsPage/components/OrgOauthClientsTab";

export const OauthApplicationsPage = () => {
  const { isSubOrganization } = useOrganization();

  return (
    <>
      <Helmet>
        <title>Vaultix | OAuth Applications</title>
        <link rel="icon" href="/favicon.svg" />
        <meta property="og:image" content="/images/vaultix-social.png" />
      </Helmet>
      <div className="flex w-full justify-center bg-bunker-800 text-white">
        <div className="w-full max-w-8xl">
          <PageHeader
            scope={isSubOrganization ? "namespace" : "org"}
            title="OAuth Applications"
            description="Control how external platforms access Vaultix on behalf of your users via OAuth 2.0."
          />
          <OrgOauthClientsTab />
        </div>
      </div>
    </>
  );
};
