import { z } from "zod";

export enum TableName {
  Users = "vx_auth_users",
  EmailDomains = "vx_auth_email_domains",
  // ssh_* tables were dropped with the SSH product; members kept for historical migrations
  SshHostGroup = "vx_pki_ssh_host_groups",
  SshHostGroupMembership = "vx_pki_ssh_host_group_memberships",
  SshHost = "vx_pki_ssh_hosts",
  SshHostLoginUser = "vx_pki_ssh_host_login_users",
  SshHostLoginUserMapping = "vx_pki_ssh_host_login_user_mappings",
  SshCertificateAuthority = "vx_pki_ssh_certificate_authorities",
  SshCertificateAuthoritySecret = "vx_pki_ssh_certificate_authority_secrets",
  SshCertificateTemplate = "vx_pki_ssh_certificate_templates",
  SshCertificate = "vx_pki_ssh_certificates",
  SshCertificateBody = "vx_pki_ssh_certificate_bodies",
  CertificateAuthority = "vx_pki_certificate_authorities",
  ExternalCertificateAuthority = "vx_pki_external_certificate_authorities",
  InternalCertificateAuthority = "vx_pki_internal_certificate_authorities",
  CertificateTemplateEstConfig = "vx_pki_certificate_template_est_configs",
  CertificateAuthorityCert = "vx_pki_certificate_authority_certs",
  CertificateAuthoritySecret = "vx_pki_certificate_authority_secret",
  CertificateAuthorityCrl = "vx_pki_certificate_authority_crl",
  Certificate = "vx_pki_certificates",
  CertificateBody = "vx_pki_certificate_bodies",
  CertificateRequests = "vx_pki_certificate_requests",
  CertificateSecret = "vx_pki_certificate_secrets",
  CertificateTemplate = "vx_pki_certificate_templates",
  PkiCertificateTemplateV2 = "vx_pki_certificate_templates_v2",
  PkiCertificatePolicy = "vx_pki_certificate_policies",
  PkiCertificateProfile = "vx_pki_certificate_profiles",
  PkiApplication = "vx_pki_applications",
  PkiApplicationProfile = "vx_pki_application_profiles",
  PkiEstEnrollmentConfig = "vx_pki_est_enrollment_configs",
  PkiApiEnrollmentConfig = "vx_pki_api_enrollment_configs",
  PkiAcmeEnrollmentConfig = "vx_pki_acme_enrollment_configs",
  PkiScepEnrollmentConfig = "vx_pki_scep_enrollment_configs",
  PkiScepTransaction = "vx_pki_scep_transactions",
  PkiScepDynamicChallenge = "vx_pki_scep_dynamic_challenges",
  PkiSubscriber = "vx_pki_subscribers",
  PkiAlert = "vx_pki_alerts",
  PkiAlertsV2 = "vx_pki_alerts_v2",
  PkiAlertChannels = "vx_pki_alert_channels",
  PkiAlertHistory = "vx_pki_alert_history",
  PkiAlertHistoryCertificate = "vx_pki_alert_history_certificate",
  PkiCollection = "vx_pki_collections",
  PkiCollectionItem = "vx_pki_collection_items",
  Alert = "vx_operate_alerts",
  AlertChannel = "vx_operate_alert_channels",
  AlertChannelRecipient = "vx_operate_alert_channel_recipients",
  AlertChannelMembership = "vx_operate_alert_channel_memberships",
  AlertHistory = "vx_operate_alert_history",
  AlertHistoryTarget = "vx_operate_alert_history_targets",
  Groups = "vx_workspace_groups",
  GroupProjectMembership = "vx_workspace_group_project_memberships",
  GroupProjectMembershipRole = "vx_workspace_group_project_membership_roles",
  ExternalGroupOrgRoleMapping = "vx_auth_external_group_role_mappings",
  UserGroupMembership = "vx_workspace_user_group_memberships",
  IdentityGroupMembership = "vx_identity_group_memberships",
  UserAliases = "vx_auth_user_aliases",
  UserEncryptionKey = "vx_auth_user_encryption_keys",
  AuthTokens = "vx_auth_tokens",
  AuthTokenSession = "vx_auth_sessions",
  BackupPrivateKey = "vx_auth_backup_private_keys",
  Organization = "vx_workspace_organizations",
  OrgMembership = "vx_workspace_org_memberships",
  OrgRoles = "vx_workspace_org_roles",
  OrgBot = "vx_workspace_org_bots",
  IncidentContact = "vx_workspace_incident_contacts",
  UserAction = "vx_auth_user_actions",
  UserSecretActivation = "vx_auth_user_secret_activation",
  SignupOnboardingResponse = "vx_auth_signup_onboarding_responses",
  SuperAdmin = "vx_operate_instance_config",
  RateLimit = "vx_operate_rate_limits",
  // dropped with the SSH product; member kept for historical migrations
  ProjectSshConfig = "vx_pki_ssh_project_configs",
  Project = "vx_workspace_projects",
  ProjectBot = "vx_workspace_project_bots",
  Environment = "vx_workspace_environments",
  ProjectMembership = "vx_workspace_project_memberships",
  ProjectRoles = "vx_workspace_project_roles",
  ProjectUserAdditionalPrivilege = "vx_workspace_project_user_additional_privileges",
  ProjectUserMembershipRole = "vx_workspace_project_user_membership_roles",
  ProjectKeys = "vx_workspace_project_keys",
  ProjectTemplates = "vx_workspace_project_templates",
  ProjectTemplateUserMembership = "vx_workspace_project_template_user_memberships",
  ProjectTemplateGroupMembership = "vx_workspace_project_template_group_memberships",
  ProjectTemplateIdentityMembership = "vx_workspace_project_template_identity_memberships",
  Secret = "vx_secrets_legacy_secrets",
  SecretReference = "vx_secrets_legacy_references",
  SecretSharing = "vx_secrets_shares",
  OrganizationAsset = "vx_workspace_org_assets",
  SecretBlindIndex = "vx_secrets_legacy_blind_indexes",
  SecretVersion = "vx_secrets_legacy_versions",
  SecretFolder = "vx_secrets_folders",
  SecretFolderVersion = "vx_secrets_folder_versions",
  SecretImport = "vx_secrets_imports",
  ProjectFolderGrant = "vx_secrets_folder_grants",
  Snapshot = "vx_secrets_snapshots",
  SnapshotSecret = "vx_secrets_legacy_snapshot_secrets",
  SnapshotFolder = "vx_secrets_snapshot_folders",
  SecretTag = "vx_secrets_tags",
  Integration = "vx_connect_legacy_integrations",
  IntegrationAuth = "vx_connect_legacy_integration_auths",
  ServiceToken = "vx_identity_service_tokens",
  Webhook = "vx_connect_webhooks",
  Identity = "vx_identity_identities",
  IdentityAccessToken = "vx_identity_access_tokens",
  IdentityAccessTokenRevocation = "vx_identity_access_token_revocations",
  IdentityTokenAuth = "vx_identity_token_auths",
  IdentityUniversalAuth = "vx_identity_universal_auths",
  IdentityKubernetesAuth = "vx_identity_kubernetes_auths",
  IdentityGcpAuth = "vx_identity_gcp_auths",
  IdentityAzureAuth = "vx_identity_azure_auths",
  IdentityUaClientSecret = "vx_identity_ua_client_secrets",
  IdentityAliCloudAuth = "vx_identity_alicloud_auths",
  IdentityAwsAuth = "vx_identity_aws_auths",
  IdentityOciAuth = "vx_identity_oci_auths",
  IdentityOidcAuth = "vx_identity_oidc_auths",
  IdentityJwtAuth = "vx_identity_jwt_auths",
  IdentityLdapAuth = "vx_identity_ldap_auths",
  IdentityTlsCertAuth = "vx_identity_tls_cert_auths",
  IdentitySpiffeAuth = "vx_identity_spiffe_auths",
  IdentityOrgMembership = "vx_identity_org_memberships",
  IdentityProjectMembership = "vx_identity_project_memberships",
  IdentityProjectMembershipRole = "vx_identity_project_membership_role",
  IdentityProjectAdditionalPrivilege = "vx_identity_project_additional_privilege",
  IdentityAuthTemplate = "vx_identity_auth_templates",
  // used by both identity and users
  IdentityMetadata = "vx_identity_metadata",
  ResourceMetadata = "vx_identity_resource_metadata",
  ScimToken = "vx_auth_scim_tokens",
  AccessApprovalPolicy = "vx_policy_access_approval_policies",
  AccessApprovalPolicyApprover = "vx_policy_access_approval_policies_approvers",
  AccessApprovalPolicyBypasser = "vx_policy_access_approval_policies_bypassers",
  AccessApprovalRequest = "vx_policy_access_approval_requests",
  AccessApprovalRequestReviewer = "vx_policy_access_approval_requests_reviewers",
  AccessApprovalPolicyEnvironment = "vx_policy_access_approval_policies_environments",
  ProjectAccessRequest = "vx_policy_access_requests",
  SecretApprovalPolicy = "vx_policy_secret_approval_policies",
  SecretApprovalPolicyApprover = "vx_policy_secret_approval_policies_approvers",
  SecretApprovalPolicyBypasser = "vx_policy_secret_approval_policies_bypassers",
  SecretApprovalRequest = "vx_policy_secret_approval_requests",
  SecretApprovalRequestReviewer = "vx_policy_secret_approval_requests_reviewers",
  SecretApprovalRequestSecret = "vx_policy_secret_approval_requests_secrets",
  SecretApprovalRequestSecretTag = "vx_policy_secret_approval_request_secret_tags",
  SecretApprovalPolicyEnvironment = "vx_policy_secret_approval_policies_environments",
  SamlConfig = "vx_auth_saml_configs",
  LdapConfig = "vx_auth_ldap_configs",
  OidcConfig = "vx_auth_oidc_configs",
  LdapGroupMap = "vx_auth_ldap_group_maps",
  AuditLog = "vx_operate_audit_logs",
  AuditLogStream = "vx_operate_audit_log_streams",
  AuditLogStreamOutbox = "vx_operate_audit_log_stream_outbox",
  GitAppInstallSession = "vx_connect_git_app_install_sessions",
  GitAppOrg = "vx_connect_git_app_org",
  SecretScanningGitRisk = "vx_scan_git_risks",
  TrustedIps = "vx_auth_trusted_ips",
  DynamicSecret = "vx_secrets_dynamic_secrets",
  DynamicSecretLease = "vx_secrets_dynamic_secret_leases",
  SecretV2 = "vx_secrets_secrets",
  SecretReferenceV2 = "vx_secrets_references",
  SecretVersionV2 = "vx_secrets_versions",
  SecretApprovalRequestSecretV2 = "vx_policy_secret_approval_requests_secrets_v2",
  SecretApprovalRequestSecretTagV2 = "vx_policy_secret_approval_request_secret_tags_v2",
  SnapshotSecretV2 = "vx_secrets_snapshot_secrets",
  ProjectSplitBackfillIds = "vx_workspace_project_split_backfill_ids",
  UserNotifications = "vx_operate_notifications",
  ScimEvents = "vx_auth_scim_events",
  // Gateway
  OrgGatewayConfig = "vx_net_legacy_gateway_configs",
  Gateway = "vx_net_legacy_gateways",
  ProjectGateway = "vx_net_project_gateways",
  // junction tables with tags
  SecretV2JnTag = "vx_secrets_tag_junction",
  JnSecretTag = "vx_secrets_legacy_tag_junction",
  SecretVersionTag = "vx_secrets_legacy_version_tag_junction",
  SecretVersionV2Tag = "vx_secrets_version_tag_junction",
  // KMS Service
  KmsServerRootConfig = "vx_kms_root_config",
  KmsKey = "vx_kms_keys",
  ExternalKms = "vx_kms_external",
  InternalKms = "vx_kms_internal",
  InternalKmsKeyVersion = "vx_kms_internal_key_versions",
  TotpConfig = "vx_auth_totp_configs",
  WebAuthnCredential = "vx_auth_webauthn_credentials",
  UserMfaRecoveryCode = "vx_auth_mfa_recovery_codes",
  // @depreciated
  KmsKeyVersion = "vx_kms_key_versions",
  WorkflowIntegrations = "vx_connect_workflow_integrations",
  VaultixEarlyAccessRequests = "vx_public_early_access_requests",
  SlackIntegrations = "vx_connect_slack_integrations",
  ProjectSlackConfigs = "vx_connect_slack_project_configs",
  AppConnection = "vx_connect_app_connections",
  AppConnectionCredentialRotation = "vx_connect_app_connection_credential_rotations",
  HsmConnector = "vx_kms_hsm_connectors",
  SecretSync = "vx_connect_secret_syncs",
  PkiSync = "vx_connect_pki_syncs",
  CertificateSync = "vx_connect_certificate_syncs",
  KmipClient = "vx_kms_kmip_clients",
  KmipOrgConfig = "vx_kms_kmip_org_configs",
  KmipOrgServerCertificates = "vx_kms_kmip_org_server_certificates",
  KmipClientCertificates = "vx_kms_kmip_client_certificates",
  KmipServer = "vx_kms_kmip_servers",
  SecretRotationV2 = "vx_secrets_rotations",
  SecretRotationV2SecretMapping = "vx_secrets_rotation_secret_mappings",
  MicrosoftTeamsIntegrations = "vx_connect_teams_integrations",
  ProjectMicrosoftTeamsConfigs = "vx_connect_teams_project_configs",
  SecretReminderRecipients = "vx_secrets_legacy_reminder_recipients", // TODO(Carlos): Remove this in the future after migrating to the new reminder recipients table
  GithubOrgSyncConfig = "vx_connect_github_org_sync_configs",
  GitHubApp = "vx_connect_github_apps",
  GitHubAppConnection = "vx_connect_github_app_connections",
  FolderCommit = "vx_secrets_folder_commits",
  FolderCommitChanges = "vx_secrets_folder_commit_changes",
  FolderCheckpoint = "vx_secrets_folder_checkpoints",
  FolderCheckpointResources = "vx_secrets_folder_checkpoint_resources",
  FolderTreeCheckpoint = "vx_secrets_folder_tree_checkpoints",
  FolderTreeCheckpointResources = "vx_secrets_folder_tree_checkpoint_resources",
  SecretScanningDataSource = "vx_scan_data_sources",
  SecretScanningResource = "vx_scan_resources",
  SecretScanningScan = "vx_scan_scans",
  SecretScanningFinding = "vx_scan_findings",
  SecretScanningConfig = "vx_scan_configs",

  Membership = "vx_workspace_memberships",
  MembershipRole = "vx_workspace_membership_roles",
  Role = "vx_workspace_roles",
  AdditionalPrivilege = "vx_workspace_additional_privileges",

  Namespace = "vx_workspace_namespaces",

  // reminders
  Reminder = "vx_secrets_reminders",
  ReminderRecipient = "vx_secrets_reminder_recipients",

  // gateway v2
  InstanceRelayConfig = "vx_net_instance_relay_configs",
  OrgRelayConfig = "vx_net_org_relay_configs",
  OrgGatewayConfigV2 = "vx_net_gateway_configs",
  Relay = "vx_net_relays",
  GatewayV2 = "vx_net_gateways",
  ResourceAuthMethod = "vx_net_resource_auth_methods",
  ResourceAwsAuth = "vx_net_resource_aws_auths",
  ResourceTokenAuth = "vx_net_resource_token_auths",
  GatewayPool = "vx_net_gateway_pools",
  GatewayPoolMembership = "vx_net_gateway_pool_memberships",

  KeyValueStore = "vx_operate_key_value_store",

  // PAM
  PamAccountTemplate = "vx_pam_account_templates",
  PamFolder = "vx_pam_folders",
  PamFolderNotificationConfig = "vx_pam_folder_notification_configs",
  PamResource = "vx_pam_resources",
  PamAccount = "vx_pam_accounts",
  PamSession = "vx_pam_sessions",
  PamSessionEventBatch = "vx_pam_session_event_batches",
  PamSessionEventChunk = "vx_pam_session_event_chunks",
  PamProjectRecordingConfig = "vx_pam_project_recording_configs",
  PamDiscoverySource = "vx_pam_discovery_sources",
  PamDiscoverySourceRun = "vx_pam_discovery_source_runs",
  PamDiscoveredAccount = "vx_pam_discovered_accounts",
  PamDiscoverySourceResource = "vx_pam_discovery_source_resources",
  PamDiscoverySourceAccount = "vx_pam_discovery_source_accounts",
  PamDiscoverySourceDependency = "vx_pam_discovery_source_dependencies",
  PamAccountDependency = "vx_pam_account_dependencies",
  PamResourceRotationRule = "vx_pam_resource_rotation_rules",
  PamResourceFavorite = "vx_pam_resource_favorites",
  PamDomain = "vx_pam_domains",
  PamAccountPolicy = "vx_pam_account_policies",

  VaultExternalMigrationConfig = "vx_connect_vault_migration_configs",
  ExternalMigrationConfig = "vx_connect_migration_configs",

  // PKI ACME
  PkiAcmeAccount = "vx_pki_acme_accounts",
  PkiAcmeOrder = "vx_pki_acme_orders",
  PkiAcmeOrderAuth = "vx_pki_acme_order_auths",
  PkiAcmeAuth = "vx_pki_acme_auths",
  PkiAcmeChallenge = "vx_pki_acme_challenges",

  // PKI Discovery
  PkiDiscoveryConfig = "vx_pki_discovery_configs",
  PkiCertificateInstallation = "vx_pki_certificate_installations",
  PkiDiscoveryInstallation = "vx_pki_discovery_installations",
  PkiCertificateInstallationCert = "vx_pki_certificate_installation_certs",
  PkiDiscoveryScanHistory = "vx_pki_discovery_scan_history",

  // PKI Cleanup
  CertificateCleanupConfig = "vx_pki_certificate_cleanup_configs",

  // PKI Inventory Views
  CertificateInventoryView = "vx_pki_certificate_inventory_views",

  // AI (ai_mcp_* tables were dropped with Agent Sentinel; members kept for historical migrations)
  AiMcpServer = "vx_ai_mcp_servers",
  AiMcpServerTool = "vx_ai_mcp_server_tools",
  AiMcpServerUserCredential = "vx_ai_mcp_server_user_credentials",
  AiMcpEndpoint = "vx_ai_mcp_endpoints",
  AiMcpEndpointServer = "vx_ai_mcp_endpoint_servers",
  AiMcpEndpointServerTool = "vx_ai_mcp_endpoint_server_tools",
  AiMcpActivityLog = "vx_ai_mcp_activity_logs",

  // Approval Policies
  ApprovalPolicies = "vx_policy_approval_policies",
  ApprovalPolicySteps = "vx_policy_approval_policy_steps",
  ApprovalPolicyStepApprovers = "vx_policy_approval_policy_step_approvers",
  ApprovalPolicyBypassers = "vx_policy_approval_policy_bypassers",
  ApprovalRequests = "vx_policy_approval_requests",
  ApprovalRequestSteps = "vx_policy_approval_request_steps",
  ApprovalRequestStepEligibleApprovers = "vx_policy_approval_request_step_eligible_approvers",
  ApprovalRequestApprovals = "vx_policy_approval_request_approvals",
  ApprovalRequestGrants = "vx_policy_approval_request_grants",

  // Code Signing
  PkiSigners = "vx_pki_signers",
  PkiSignerCertificateIssuanceJobs = "vx_pki_signer_certificate_issuance_jobs",
  PkiSigningOperations = "vx_pki_signing_operations",

  CaSigningConfig = "vx_pki_ca_signing_configs",
  SecretValidationRule = "vx_policy_secret_validation_rules",

  // OAuth 2.0 authorization server (Vaultix as an OAuth provider)
  OauthClient = "vx_auth_oauth_clients",

  // Honey Tokens
  HoneyTokenConfig = "vx_secrets_honey_token_configs",
  HoneyToken = "vx_secrets_honey_tokens",
  HoneyTokenEvent = "vx_secrets_honey_token_events",
  HoneyTokenSecretMapping = "vx_secrets_honey_token_secret_mappings",

  // Audit Reports (exportable compliance reports)
  AuditReport = "vx_operate_audit_reports",

  // Secrets Brokering (Agent Proxy)
  OrgAgentProxyConfig = "vx_connect_agent_proxy_configs",
  ProxiedService = "vx_connect_proxied_services",
  ProxiedServiceCredential = "vx_connect_proxied_service_credentials",

  // Deprecated - Not used anymore now that Redis is persistent
  DeprecatedDurableQueueJobs = "vx_operate_queue_jobs",
  DeprecatedSecretRotationV1 = "vx_secrets_legacy_rotations",
  DeprecatedSecretRotationOutput = "vx_secrets_legacy_rotation_outputs",
  DeprecatedSecretRotationOutputV2 = "vx_secrets_legacy_rotation_outputs_v2",
  DeprecatedApiKey = "vx_auth_api_keys"
}

export type TImmutableDBKeys = "id" | "createdAt" | "updatedAt" | "commitId";

export const UserDeviceSchema = z
  .object({
    ip: z.string(),
    userAgent: z.string()
  })
  .array()
  .default([]);

export const ServiceTokenScopes = z
  .object({
    environment: z.string(),
    secretPath: z.string().default("/")
  })
  .array();

export enum OrgMembershipRole {
  Admin = "admin",
  Member = "member",
  NoAccess = "no-access",
  Custom = "custom"
}

export enum OrgMembershipStatus {
  Invited = "invited",
  Accepted = "accepted"
}

export enum ProjectMembershipRole {
  // general
  Admin = "admin",
  Member = "member",
  Custom = "custom",
  Viewer = "viewer",
  NoAccess = "no-access",
  // kms
  KmsCryptographicOperator = "cryptographic-operator"
}

export enum ResourceMembershipRole {
  Admin = "admin",
  Operator = "operator",
  Auditor = "auditor",
  Custom = "custom"
}

export enum ResourceType {
  CertificateApplication = "certificate-application",
  Signer = "pki-signer",
  PamFolder = "pam-folder",
  PamAccount = "pam-account"
}

export enum SecretEncryptionAlgo {
  AES_256_GCM = "aes-256-gcm"
}

export enum SecretKeyEncoding {
  UTF8 = "utf8",
  BASE64 = "base64",
  HEX = "hex"
}

export enum SecretType {
  Shared = "shared",
  Personal = "personal"
}

export enum ProjectVersion {
  V1 = 1,
  V2 = 2,
  V3 = 3
}

export enum ProjectUpgradeStatus {
  InProgress = "IN_PROGRESS",
  // Completed -> Will be null if completed. So a completed status is not needed
  Failed = "FAILED"
}

export enum IdentityAuthMethod {
  TOKEN_AUTH = "token-auth",
  UNIVERSAL_AUTH = "universal-auth",
  KUBERNETES_AUTH = "kubernetes-auth",
  GCP_AUTH = "gcp-auth",
  ALICLOUD_AUTH = "alicloud-auth",
  AWS_AUTH = "aws-auth",
  AZURE_AUTH = "azure-auth",
  TLS_CERT_AUTH = "tls-cert-auth",
  OCI_AUTH = "oci-auth",
  OIDC_AUTH = "oidc-auth",
  JWT_AUTH = "jwt-auth",
  LDAP_AUTH = "ldap-auth",
  SPIFFE_AUTH = "spiffe-auth"
}

export enum ProjectType {
  SecretManager = "secret-manager",
  CertificateManager = "cert-manager",
  KMS = "kms",
  SecretScanning = "secret-scanning",
  PAM = "pam"
}

export enum ActionProjectType {
  SecretManager = ProjectType.SecretManager,
  CertificateManager = ProjectType.CertificateManager,
  KMS = ProjectType.KMS,
  SecretScanning = ProjectType.SecretScanning,
  PAM = ProjectType.PAM,
  // project operations that happen on all types
  Any = "any"
}

export enum OrganizationActionScope {
  ChildOrganization = "child-organization-only",
  ParentOrganization = "parent-organization-only",
  Any = "any"
}

export enum TemporaryPermissionMode {
  Relative = "relative"
}

export enum MembershipActors {
  Group = "group",
  User = "user",
  Identity = "identity"
}

export enum SortDirection {
  ASC = "asc",
  DESC = "desc"
}

export enum AccessScope {
  Organization = "organization",
  Project = "project"
}

export const RESOURCE_SCOPE = "resource";

export type AccessScopeData =
  | {
      scope: AccessScope.Organization;
      orgId: string;
    }
  | {
      scope: AccessScope.Project;
      orgId: string;
      projectId: string;
    };
