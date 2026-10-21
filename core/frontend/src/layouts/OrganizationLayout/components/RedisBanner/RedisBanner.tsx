import { OrgAlertBanner } from "../OrgAlertBanner";

export const RedisBanner = () => {
  return (
    <OrgAlertBanner
      text="Attention: Updated versions of Vaultix now require Redis for full functionality."
      link="https://vaultix.shippin.cloud/docs/self-hosting/configuration/requirements#redis"
    />
  );
};
