import { AppConnection } from "../app-connection/app-connection-enums";

// Providers whose secrets can be reviewed, approved and imported into a Vaultix folder.
// ExternalVaultix is an instance speaking this API: another Vaultix, or Infisical Cloud or self-hosted.
export const IMPORT_PROVIDERS = [AppConnection.Doppler, AppConnection.ExternalVaultix] as const;
export type TImportProvider = (typeof IMPORT_PROVIDERS)[number];

export const IMPORT_LIFECYCLE = ["review", "approve", "import"] as const;

export const MAX_IMPORT_KEYS = 5000;

export type TImportSourceSecret = {
  secretKey: string;
  secretValue: string;
  secretComment?: string;
  valueHidden?: boolean;
};

export type TImportKeyAction = "create" | "exists" | "denied" | "unreadable";

export type TImportPlanKey = { key: string; action: TImportKeyAction };

export type TImportPlan = {
  keys: TImportPlanKey[];
  sourceCount: number;
  createCount: number;
  existingCount: number;
};

// A key is importable only when the source value is readable, the destination does not have it,
// and the actor may create it there. Values never enter the plan.
export const planProviderImport = ({
  source,
  existingKeys,
  canCreate
}: {
  source: TImportSourceSecret[];
  existingKeys: Iterable<string>;
  canCreate: (key: string) => boolean;
}): TImportPlan => {
  const existing = new Set(existingKeys);
  const seen = new Set<string>();
  const keys: TImportPlanKey[] = [];
  for (const secret of source) {
    if (secret.secretKey && !seen.has(secret.secretKey)) {
      seen.add(secret.secretKey);
      let action: TImportKeyAction = "create";
      if (existing.has(secret.secretKey)) action = "exists";
      else if (secret.valueHidden) action = "unreadable";
      else if (!canCreate(secret.secretKey)) action = "denied";
      keys.push({ key: secret.secretKey, action });
    }
  }
  keys.sort((a, b) => a.key.localeCompare(b.key));
  return {
    keys,
    sourceCount: keys.length,
    createCount: keys.filter((k) => k.action === "create").length,
    existingCount: keys.filter((k) => k.action === "exists").length
  };
};

// The human approved a reviewed list. Anything that moved since then is refused as a whole.
export const findStaleApprovedKeys = (plan: TImportPlan, approvedKeys: string[]) => {
  const creatable = new Set(plan.keys.filter((k) => k.action === "create").map((k) => k.key));
  return [...new Set(approvedKeys)].filter((key) => !creatable.has(key));
};

export const isImportProvider = (value: string): value is TImportProvider =>
  (IMPORT_PROVIDERS as readonly string[]).includes(value);
