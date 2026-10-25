import { Detail, DetailLabel, DetailValue } from "@app/components/v3";
import { TExternalVaultixSync } from "@app/hooks/api/secretSyncs/types/external-vaultix-sync";

type Props = {
  secretSync: TExternalVaultixSync;
};

export const ExternalVaultixSyncDestinationSection = ({ secretSync }: Props) => {
  const { destinationConfig } = secretSync;

  return (
    <>
      <Detail>
        <DetailLabel>Project ID</DetailLabel>
        <DetailValue>{destinationConfig.projectId}</DetailValue>
      </Detail>
      <Detail>
        <DetailLabel>Environment</DetailLabel>
        <DetailValue>{destinationConfig.environment}</DetailValue>
      </Detail>
      <Detail>
        <DetailLabel>Secret Path</DetailLabel>
        <DetailValue>{destinationConfig.secretPath}</DetailValue>
      </Detail>
    </>
  );
};
