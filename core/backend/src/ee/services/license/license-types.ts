import { TOrgPermission } from "@app/lib/types";
import { TEntitlementsResponse } from "@app/services/license-client/license-client-types";

export enum InstanceType {
  OnPrem = "self-hosted",
  // Self-hosted online license: features are resolved from License Server v2.
  EnterpriseOnPrem = "enterprise-self-hosted",
  EnterpriseOnPremOffline = "enterprise-self-hosted-offline",
  Cloud = "cloud"
}

export type TOfflineLicenseContents = {
  license: TOfflineLicense;
  signature: string;
};

export type TOfflineLicense = {
  issuedTo: string;
  licenseId: string;
  customerId: string | null;
  issuedAt: string;
  expiresAt: string | null;
  terminatesAt: string | null;
  // v1 (or absent) offline licenses carry the legacy feature-flag set directly; version 2 licenses
  // carry License Server v2 entitlements, which we project into the same feature shape.
  version?: number;
  features: TFeatureSet;
  entitlements?: TEntitlementsResponse;
};

export type TPlanBillingInfo = {
  currentPeriodStart: number;
  currentPeriodEnd: number;
  interval: "month" | "year";
  intervalCount: number;
  amount: number;
  quantity: number;
};

export type TFeatureSet = {
  _id: null;
  slug: string | null;
  // True when features are sourced from an offline (air-gapped) license; the billing UI renders a
  // read-only offline banner instead of the live billing surface.
  isOffline?: boolean;
  tier: -1;
  workspaceLimit: null;
  workspacesUsed: number;
  dynamicSecret: boolean;
  memberLimit: null;
  membersUsed: number;
  identityLimit: null;
  identitiesUsed: number;
  enforceIdentityLimit?: boolean;
  subOrganization: boolean;
  environmentLimit: null;
  environmentsUsed: 0;
  secretVersioning: boolean;
  pitRecovery: boolean;
  ipAllowlisting: boolean;
  rbac: boolean;
  customRateLimits: boolean;
  customAlerts: boolean;
  auditLogs: boolean;
  auditLogsRetentionDays: number;
  auditLogStreams: boolean;
  auditLogStreamLimit: number;
  githubOrgSync: boolean;
  samlSSO: boolean;
  enforceGoogleSSO: boolean;
  hsm: boolean;
  oidcSSO: boolean;
  secretAccessInsights: boolean;
  scim: boolean;
  ldap: boolean;
  groups: boolean;
  status: null;
  trial_end: null;
  has_used_trial: boolean;
  secretApproval: boolean;
  secretRotation: boolean;
  caCrl: boolean;
  instanceUserManagement: boolean;
  externalKms: boolean;
  rateLimits: {
    readLimit: number;
    writeLimit: number;
    secretsLimit: number;
  };
  pkiEst: boolean;
  pkiAcme: boolean;
  pkiScep: boolean;
  pkiPqc: boolean;
  // PKI code signing capability. null (default) is ignored (no restriction); an explicit boolean gates
  // code signer creation.
  pkiCodeSigning: null;
  kmsPqc: boolean;
  enforceMfa: boolean;
  projectTemplates: boolean;
  kmip: boolean;
  gateway: boolean;
  gatewayPool: boolean;
  pamSlackNotifications: boolean;
  secretScanning: boolean;
  enterpriseSecretSyncs: boolean;
  enterpriseCertificateSyncs: boolean;
  enterpriseAppConnections: boolean;
  machineIdentityAuthTemplates: boolean;
  pkiLegacyTemplates: boolean;
  fips: boolean;
  eventSubscriptions: boolean;
  secretShareExternalBranding: boolean;
  honeyTokens: boolean;
  honeyTokenLimit: number;
  secretsBrokering: boolean;
  secretSyncLimit: null;
  maxInternalCas: null;
  maxPamAccounts: null;
  pam: null;
  certManager: null;
  secretsTemporaryAccess: null;
  enterprisePamAccount: null;
  crossProjectSecretSharing: boolean;
};

export type TOrgPlansTableDTO = {
  billingCycle: string;
} & TOrgPermission;

export type TOrgPlanDTO = {
  projectId?: string;
  refreshCache?: boolean;
  rootOrgId: string;
} & TOrgPermission;

export type TStartOrgTrialDTO = {
  success_url: string;
} & TOrgPermission;

export type TCreateOrgPortalSession = TOrgPermission;

export type TGetOrgBillInfoDTO = TOrgPermission;

export type TOrgPlanTableDTO = TOrgPermission;

export type TOrgBillingDetailsDTO = TOrgPermission;

export type TUpdateOrgBillingDetailsDTO = TOrgPermission & {
  name?: string;
  email?: string;
};

export type TOrgPmtMethodsDTO = TOrgPermission;

export type TAddOrgPmtMethodDTO = TOrgPermission & { success_url: string; cancel_url: string };

export type TDelOrgPmtMethodDTO = TOrgPermission & { pmtMethodId: string };

export type TGetOrgTaxIdDTO = TOrgPermission;

export type TAddOrgTaxIdDTO = TOrgPermission & { type: string; value: string };

export type TDelOrgTaxIdDTO = TOrgPermission & { taxId: string };

export type TOrgInvoiceDTO = TOrgPermission;

export type TOrgLicensesDTO = TOrgPermission;

export enum LicenseType {
  Offline = "offline",
  // Self-hosted online license key; resolves entitlements from License Server v2.
  Online = "online"
}

export type TLicenseKeyConfig =
  | {
      isValid: false;
    }
  | {
      isValid: true;
      licenseKey: string;
      type: LicenseType;
    };
