import { TExternalVaultixSync } from "@app/hooks/api/secretSyncs/types/external-vaultix-sync";

import { getSecretSyncDestinationColValues } from "../helpers";
import { SecretSyncTableCell } from "../SecretSyncTableCell";

type Props = {
  secretSync: TExternalVaultixSync;
};

export const ExternalVaultixSyncDestinationCol = ({ secretSync }: Props) => {
  const { primaryText, secondaryText } = getSecretSyncDestinationColValues(secretSync);
  return <SecretSyncTableCell primaryText={primaryText} secondaryText={secondaryText} />;
};
