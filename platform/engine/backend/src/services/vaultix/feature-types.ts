// What this instance offers. Every software feature is included (docs/0016).
export enum InstanceType {
  OnPrem = "self-hosted",
  EnterpriseOnPrem = "enterprise-self-hosted",
  EnterpriseOnPremOffline = "enterprise-self-hosted-offline",
  Cloud = "cloud"
}

export type TFeatureSet = {
  _id: null;
  slug: string | null;
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
