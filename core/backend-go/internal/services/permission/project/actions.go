package project

import "github.com/vaultix-cloud/api/internal/vaultixpolicy"

// --- Role constants (ProjectMembershipRole) ---

const (
	RoleAdmin                    = "admin"
	RoleMember                   = "member"
	RoleViewer                   = "viewer"
	RoleNoAccess                 = "no-access"
	RoleCustom                   = "custom"
	RoleKmsCryptographicOperator = "cryptographic-operator"
)

// --- Typed actions per subject ---

// Secret actions (ProjectPermissionSecretActions)
var (
	SecretActionDescribeAndReadValue = vaultixpolicy.DefineAction[SecretSubject]("read")
	SecretActionDescribeSecret       = vaultixpolicy.DefineAction[SecretSubject]("describeSecret")
	SecretActionReadValue            = vaultixpolicy.DefineAction[SecretSubject]("readValue")
	SecretActionCreate               = vaultixpolicy.DefineAction[SecretSubject]("create")
	SecretActionEdit                 = vaultixpolicy.DefineAction[SecretSubject]("edit")
	SecretActionDelete               = vaultixpolicy.DefineAction[SecretSubject]("delete")
)

// SecretFolder actions (ProjectPermissionActions on SecretFolderSubject)
var (
	SecretFolderActionRead   = vaultixpolicy.DefineAction[SecretFolderSubject]("read")
	SecretFolderActionCreate = vaultixpolicy.DefineAction[SecretFolderSubject]("create")
	SecretFolderActionEdit   = vaultixpolicy.DefineAction[SecretFolderSubject]("edit")
	SecretFolderActionDelete = vaultixpolicy.DefineAction[SecretFolderSubject]("delete")
)

// SecretImport actions
var (
	SecretImportActionRead   = vaultixpolicy.DefineAction[SecretImportSubject]("read")
	SecretImportActionCreate = vaultixpolicy.DefineAction[SecretImportSubject]("create")
	SecretImportActionEdit   = vaultixpolicy.DefineAction[SecretImportSubject]("edit")
	SecretImportActionDelete = vaultixpolicy.DefineAction[SecretImportSubject]("delete")
)

// DynamicSecret actions (ProjectPermissionDynamicSecretActions)
var (
	DynamicSecretActionReadRootCredential   = vaultixpolicy.DefineAction[DynamicSecretSubject]("read-root-credential")
	DynamicSecretActionCreateRootCredential = vaultixpolicy.DefineAction[DynamicSecretSubject]("create-root-credential")
	DynamicSecretActionEditRootCredential   = vaultixpolicy.DefineAction[DynamicSecretSubject]("edit-root-credential")
	DynamicSecretActionDeleteRootCredential = vaultixpolicy.DefineAction[DynamicSecretSubject]("delete-root-credential")
	DynamicSecretActionLease                = vaultixpolicy.DefineAction[DynamicSecretSubject]("lease")
)

// SecretRollback actions
var (
	SecretRollbackActionRead   = vaultixpolicy.DefineAction[SecretRollbackSubject]("read")
	SecretRollbackActionCreate = vaultixpolicy.DefineAction[SecretRollbackSubject]("create")
)

// SecretApproval actions
var (
	SecretApprovalActionRead   = vaultixpolicy.DefineAction[SecretApprovalSubject]("read")
	SecretApprovalActionCreate = vaultixpolicy.DefineAction[SecretApprovalSubject]("create")
	SecretApprovalActionEdit   = vaultixpolicy.DefineAction[SecretApprovalSubject]("edit")
	SecretApprovalActionDelete = vaultixpolicy.DefineAction[SecretApprovalSubject]("delete")
)

// SecretApprovalRequest actions
var SecretApprovalRequestActionRead = vaultixpolicy.DefineAction[SecretApprovalRequestSubject]("read")

// SecretSync actions (ProjectPermissionSecretSyncActions)
var (
	SecretSyncActionRead          = vaultixpolicy.DefineAction[SecretSyncSubject]("read")
	SecretSyncActionCreate        = vaultixpolicy.DefineAction[SecretSyncSubject]("create")
	SecretSyncActionEdit          = vaultixpolicy.DefineAction[SecretSyncSubject]("edit")
	SecretSyncActionDelete        = vaultixpolicy.DefineAction[SecretSyncSubject]("delete")
	SecretSyncActionSyncSecrets   = vaultixpolicy.DefineAction[SecretSyncSubject]("sync-secrets")
	SecretSyncActionImportSecrets = vaultixpolicy.DefineAction[SecretSyncSubject]("import-secrets")
	SecretSyncActionRemoveSecrets = vaultixpolicy.DefineAction[SecretSyncSubject]("remove-secrets")
)

// SecretRotation actions (ProjectPermissionSecretRotationActions)
var (
	SecretRotationActionRead               = vaultixpolicy.DefineAction[SecretRotationSubject]("read")
	SecretRotationActionReadGeneratedCreds = vaultixpolicy.DefineAction[SecretRotationSubject]("read-generated-credentials")
	SecretRotationActionCreate             = vaultixpolicy.DefineAction[SecretRotationSubject]("create")
	SecretRotationActionEdit               = vaultixpolicy.DefineAction[SecretRotationSubject]("edit")
	SecretRotationActionDelete             = vaultixpolicy.DefineAction[SecretRotationSubject]("delete")
	SecretRotationActionRotateSecrets      = vaultixpolicy.DefineAction[SecretRotationSubject]("rotate-secrets")
)

// SecretEvent actions (ProjectPermissionSecretEventActions)
var (
	SecretEventActionSubscribeCreation       = vaultixpolicy.DefineAction[SecretEventSubject]("subscribe-to-creation-events")
	SecretEventActionSubscribeUpdate         = vaultixpolicy.DefineAction[SecretEventSubject]("subscribe-to-update-events")
	SecretEventActionSubscribeDelete         = vaultixpolicy.DefineAction[SecretEventSubject]("subscribe-to-deletion-events")
	SecretEventActionSubscribeImportMutation = vaultixpolicy.DefineAction[SecretEventSubject]("subscribe-to-import-mutation-events")
)

// Commits actions (ProjectPermissionCommitsActions)
var (
	CommitsActionRead            = vaultixpolicy.DefineAction[CommitsSubject]("read")
	CommitsActionPerformRollback = vaultixpolicy.DefineAction[CommitsSubject]("perform-rollback")
)

// Project actions
var (
	ProjectActionEdit   = vaultixpolicy.DefineAction[ProjectSubject]("edit")
	ProjectActionDelete = vaultixpolicy.DefineAction[ProjectSubject]("delete")
)

// Role actions
var (
	RoleActionRead   = vaultixpolicy.DefineAction[RoleSubject]("read")
	RoleActionCreate = vaultixpolicy.DefineAction[RoleSubject]("create")
	RoleActionEdit   = vaultixpolicy.DefineAction[RoleSubject]("edit")
	RoleActionDelete = vaultixpolicy.DefineAction[RoleSubject]("delete")
)

// Settings actions
var (
	SettingsActionRead   = vaultixpolicy.DefineAction[SettingsSubject]("read")
	SettingsActionCreate = vaultixpolicy.DefineAction[SettingsSubject]("create")
	SettingsActionEdit   = vaultixpolicy.DefineAction[SettingsSubject]("edit")
	SettingsActionDelete = vaultixpolicy.DefineAction[SettingsSubject]("delete")
)

// Environments actions
var (
	EnvironmentsActionRead   = vaultixpolicy.DefineAction[EnvironmentsSubject]("read")
	EnvironmentsActionCreate = vaultixpolicy.DefineAction[EnvironmentsSubject]("create")
	EnvironmentsActionEdit   = vaultixpolicy.DefineAction[EnvironmentsSubject]("edit")
	EnvironmentsActionDelete = vaultixpolicy.DefineAction[EnvironmentsSubject]("delete")
)

// Tags actions
var (
	TagsActionRead   = vaultixpolicy.DefineAction[TagsSubject]("read")
	TagsActionCreate = vaultixpolicy.DefineAction[TagsSubject]("create")
	TagsActionEdit   = vaultixpolicy.DefineAction[TagsSubject]("edit")
	TagsActionDelete = vaultixpolicy.DefineAction[TagsSubject]("delete")
)

// IpAllowList actions
var (
	IpAllowListActionRead   = vaultixpolicy.DefineAction[IpAllowListSubject]("read")
	IpAllowListActionCreate = vaultixpolicy.DefineAction[IpAllowListSubject]("create")
	IpAllowListActionEdit   = vaultixpolicy.DefineAction[IpAllowListSubject]("edit")
	IpAllowListActionDelete = vaultixpolicy.DefineAction[IpAllowListSubject]("delete")
)

// AuditLogs actions (ProjectPermissionAuditLogsActions)
var AuditLogsActionRead = vaultixpolicy.DefineAction[AuditLogsSubject]("read")

// Member actions (ProjectPermissionMemberActions)
var (
	MemberActionRead                       = vaultixpolicy.DefineAction[MemberSubject]("read")
	MemberActionCreate                     = vaultixpolicy.DefineAction[MemberSubject]("create")
	MemberActionEdit                       = vaultixpolicy.DefineAction[MemberSubject]("edit")
	MemberActionDelete                     = vaultixpolicy.DefineAction[MemberSubject]("delete")
	MemberActionGrantPrivileges            = vaultixpolicy.DefineAction[MemberSubject]("grant-privileges")
	MemberActionAssignRole                 = vaultixpolicy.DefineAction[MemberSubject]("assign-role")
	MemberActionAssignAdditionalPrivileges = vaultixpolicy.DefineAction[MemberSubject]("assign-additional-privileges")
	MemberActionAssumePrivileges           = vaultixpolicy.DefineAction[MemberSubject]("assume-privileges")
)

// Identity actions (ProjectPermissionIdentityActions)
var (
	IdentityActionRead                       = vaultixpolicy.DefineAction[IdentitySubject]("read")
	IdentityActionCreate                     = vaultixpolicy.DefineAction[IdentitySubject]("create")
	IdentityActionEdit                       = vaultixpolicy.DefineAction[IdentitySubject]("edit")
	IdentityActionDelete                     = vaultixpolicy.DefineAction[IdentitySubject]("delete")
	IdentityActionGrantPrivileges            = vaultixpolicy.DefineAction[IdentitySubject]("grant-privileges")
	IdentityActionAssignRole                 = vaultixpolicy.DefineAction[IdentitySubject]("assign-role")
	IdentityActionAssignAdditionalPrivileges = vaultixpolicy.DefineAction[IdentitySubject]("assign-additional-privileges")
	IdentityActionAssumePrivileges           = vaultixpolicy.DefineAction[IdentitySubject]("assume-privileges")
	IdentityActionRevokeAuth                 = vaultixpolicy.DefineAction[IdentitySubject]("revoke-auth")
	IdentityActionCreateToken                = vaultixpolicy.DefineAction[IdentitySubject]("create-token")
	IdentityActionGetToken                   = vaultixpolicy.DefineAction[IdentitySubject]("get-token")
	IdentityActionDeleteToken                = vaultixpolicy.DefineAction[IdentitySubject]("delete-token")
)

// Group actions (ProjectPermissionGroupActions)
var (
	GroupActionRead            = vaultixpolicy.DefineAction[GroupSubject]("read")
	GroupActionCreate          = vaultixpolicy.DefineAction[GroupSubject]("create")
	GroupActionEdit            = vaultixpolicy.DefineAction[GroupSubject]("edit")
	GroupActionDelete          = vaultixpolicy.DefineAction[GroupSubject]("delete")
	GroupActionGrantPrivileges = vaultixpolicy.DefineAction[GroupSubject]("grant-privileges")
	GroupActionAssignRole      = vaultixpolicy.DefineAction[GroupSubject]("assign-role")
)

// ServiceTokens actions
var (
	ServiceTokensActionRead   = vaultixpolicy.DefineAction[ServiceTokensSubject]("read")
	ServiceTokensActionCreate = vaultixpolicy.DefineAction[ServiceTokensSubject]("create")
	ServiceTokensActionEdit   = vaultixpolicy.DefineAction[ServiceTokensSubject]("edit")
	ServiceTokensActionDelete = vaultixpolicy.DefineAction[ServiceTokensSubject]("delete")
)

// Integrations actions
var (
	IntegrationsActionRead   = vaultixpolicy.DefineAction[IntegrationsSubject]("read")
	IntegrationsActionCreate = vaultixpolicy.DefineAction[IntegrationsSubject]("create")
	IntegrationsActionEdit   = vaultixpolicy.DefineAction[IntegrationsSubject]("edit")
	IntegrationsActionDelete = vaultixpolicy.DefineAction[IntegrationsSubject]("delete")
)

// Webhooks actions
var (
	WebhooksActionRead   = vaultixpolicy.DefineAction[WebhooksSubject]("read")
	WebhooksActionCreate = vaultixpolicy.DefineAction[WebhooksSubject]("create")
	WebhooksActionEdit   = vaultixpolicy.DefineAction[WebhooksSubject]("edit")
	WebhooksActionDelete = vaultixpolicy.DefineAction[WebhooksSubject]("delete")
)

// CertificateAuthority actions (ProjectPermissionCertificateAuthorityActions)
var (
	CaActionRead             = vaultixpolicy.DefineAction[CertificateAuthoritySubject]("read")
	CaActionCreate           = vaultixpolicy.DefineAction[CertificateAuthoritySubject]("create")
	CaActionEdit             = vaultixpolicy.DefineAction[CertificateAuthoritySubject]("edit")
	CaActionDelete           = vaultixpolicy.DefineAction[CertificateAuthoritySubject]("delete")
	CaActionIssueCACert      = vaultixpolicy.DefineAction[CertificateAuthoritySubject]("issue-ca-certificate")
	CaActionSignIntermediate = vaultixpolicy.DefineAction[CertificateAuthoritySubject]("sign-intermediate")
)

// Certificate actions (ProjectPermissionCertificateActions)
var (
	CertActionRead           = vaultixpolicy.DefineAction[CertificateSubject]("read")
	CertActionCreate         = vaultixpolicy.DefineAction[CertificateSubject]("create")
	CertActionEdit           = vaultixpolicy.DefineAction[CertificateSubject]("edit")
	CertActionDelete         = vaultixpolicy.DefineAction[CertificateSubject]("delete")
	CertActionReadPrivateKey = vaultixpolicy.DefineAction[CertificateSubject]("read-private-key")
	CertActionImport         = vaultixpolicy.DefineAction[CertificateSubject]("import")
)

// CertificateTemplate actions (ProjectPermissionPkiTemplateActions)
var (
	CertTemplateActionRead      = vaultixpolicy.DefineAction[CertificateTemplateSubject]("read")
	CertTemplateActionCreate    = vaultixpolicy.DefineAction[CertificateTemplateSubject]("create")
	CertTemplateActionEdit      = vaultixpolicy.DefineAction[CertificateTemplateSubject]("edit")
	CertTemplateActionDelete    = vaultixpolicy.DefineAction[CertificateTemplateSubject]("delete")
	CertTemplateActionIssueCert = vaultixpolicy.DefineAction[CertificateTemplateSubject]("issue-cert")
	CertTemplateActionListCerts = vaultixpolicy.DefineAction[CertificateTemplateSubject]("list-certs")
)

// CertificateProfile actions (ProjectPermissionCertificateProfileActions)
var (
	CertProfileActionRead          = vaultixpolicy.DefineAction[CertificateProfileSubject]("read")
	CertProfileActionCreate        = vaultixpolicy.DefineAction[CertificateProfileSubject]("create")
	CertProfileActionEdit          = vaultixpolicy.DefineAction[CertificateProfileSubject]("edit")
	CertProfileActionDelete        = vaultixpolicy.DefineAction[CertificateProfileSubject]("delete")
	CertProfileActionIssueCert     = vaultixpolicy.DefineAction[CertificateProfileSubject]("issue-cert")
	CertProfileActionRevealAcmeEab = vaultixpolicy.DefineAction[CertificateProfileSubject]("reveal-acme-eab-secret")
	CertProfileActionRotateAcmeEab = vaultixpolicy.DefineAction[CertificateProfileSubject]("rotate-acme-eab-secret")
)

// CertificatePolicy actions (ProjectPermissionCertificatePolicyActions)
var (
	CertPolicyActionRead   = vaultixpolicy.DefineAction[CertificatePolicySubject]("read")
	CertPolicyActionCreate = vaultixpolicy.DefineAction[CertificatePolicySubject]("create")
	CertPolicyActionEdit   = vaultixpolicy.DefineAction[CertificatePolicySubject]("edit")
	CertPolicyActionDelete = vaultixpolicy.DefineAction[CertificatePolicySubject]("delete")
)

// PkiSubscriber actions (ProjectPermissionPkiSubscriberActions)
var (
	PkiSubscriberActionRead      = vaultixpolicy.DefineAction[PkiSubscriberSubject]("read")
	PkiSubscriberActionCreate    = vaultixpolicy.DefineAction[PkiSubscriberSubject]("create")
	PkiSubscriberActionEdit      = vaultixpolicy.DefineAction[PkiSubscriberSubject]("edit")
	PkiSubscriberActionDelete    = vaultixpolicy.DefineAction[PkiSubscriberSubject]("delete")
	PkiSubscriberActionIssueCert = vaultixpolicy.DefineAction[PkiSubscriberSubject]("issue-cert")
	PkiSubscriberActionListCerts = vaultixpolicy.DefineAction[PkiSubscriberSubject]("list-certs")
)

// PkiAlerts actions
var (
	PkiAlertsActionRead   = vaultixpolicy.DefineAction[PkiAlertsSubject]("read")
	PkiAlertsActionCreate = vaultixpolicy.DefineAction[PkiAlertsSubject]("create")
	PkiAlertsActionEdit   = vaultixpolicy.DefineAction[PkiAlertsSubject]("edit")
	PkiAlertsActionDelete = vaultixpolicy.DefineAction[PkiAlertsSubject]("delete")
)

// PkiCollections actions
var (
	PkiCollectionsActionRead   = vaultixpolicy.DefineAction[PkiCollectionsSubject]("read")
	PkiCollectionsActionCreate = vaultixpolicy.DefineAction[PkiCollectionsSubject]("create")
	PkiCollectionsActionEdit   = vaultixpolicy.DefineAction[PkiCollectionsSubject]("edit")
	PkiCollectionsActionDelete = vaultixpolicy.DefineAction[PkiCollectionsSubject]("delete")
)

// PkiSync actions (ProjectPermissionPkiSyncActions)
var (
	PkiSyncActionRead               = vaultixpolicy.DefineAction[PkiSyncSubject]("read")
	PkiSyncActionCreate             = vaultixpolicy.DefineAction[PkiSyncSubject]("create")
	PkiSyncActionEdit               = vaultixpolicy.DefineAction[PkiSyncSubject]("edit")
	PkiSyncActionDelete             = vaultixpolicy.DefineAction[PkiSyncSubject]("delete")
	PkiSyncActionSyncCertificates   = vaultixpolicy.DefineAction[PkiSyncSubject]("sync-certificates")
	PkiSyncActionImportCertificates = vaultixpolicy.DefineAction[PkiSyncSubject]("import-certificates")
	PkiSyncActionRemoveCertificates = vaultixpolicy.DefineAction[PkiSyncSubject]("remove-certificates")
)

// PkiDiscovery actions (ProjectPermissionPkiDiscoveryActions)
var (
	PkiDiscoveryActionRead    = vaultixpolicy.DefineAction[PkiDiscoverySubject]("read")
	PkiDiscoveryActionCreate  = vaultixpolicy.DefineAction[PkiDiscoverySubject]("create")
	PkiDiscoveryActionEdit    = vaultixpolicy.DefineAction[PkiDiscoverySubject]("edit")
	PkiDiscoveryActionDelete  = vaultixpolicy.DefineAction[PkiDiscoverySubject]("delete")
	PkiDiscoveryActionRunScan = vaultixpolicy.DefineAction[PkiDiscoverySubject]("run-scan")
)

// PkiCertificateInstallation actions (ProjectPermissionPkiCertificateInstallationActions)
var (
	PkiCertInstallActionRead   = vaultixpolicy.DefineAction[PkiCertificateInstallsSubject]("read")
	PkiCertInstallActionEdit   = vaultixpolicy.DefineAction[PkiCertificateInstallsSubject]("edit")
	PkiCertInstallActionDelete = vaultixpolicy.DefineAction[PkiCertificateInstallsSubject]("delete")
)

// Kms actions
var KmsActionEdit = vaultixpolicy.DefineAction[KmsSubject]("edit")

// Cmek actions (ProjectPermissionCmekActions)
var (
	CmekActionRead          = vaultixpolicy.DefineAction[CmekSubject]("read")
	CmekActionCreate        = vaultixpolicy.DefineAction[CmekSubject]("create")
	CmekActionEdit          = vaultixpolicy.DefineAction[CmekSubject]("edit")
	CmekActionDelete        = vaultixpolicy.DefineAction[CmekSubject]("delete")
	CmekActionEncrypt       = vaultixpolicy.DefineAction[CmekSubject]("encrypt")
	CmekActionDecrypt       = vaultixpolicy.DefineAction[CmekSubject]("decrypt")
	CmekActionSign          = vaultixpolicy.DefineAction[CmekSubject]("sign")
	CmekActionVerify        = vaultixpolicy.DefineAction[CmekSubject]("verify")
	CmekActionExportPrivKey = vaultixpolicy.DefineAction[CmekSubject]("export-private-key")
)

// Kmip actions (ProjectPermissionKmipActions)
var (
	KmipActionCreateClients = vaultixpolicy.DefineAction[KmipSubject]("create-clients")
	KmipActionUpdateClients = vaultixpolicy.DefineAction[KmipSubject]("update-clients")
	KmipActionDeleteClients = vaultixpolicy.DefineAction[KmipSubject]("delete-clients")
	KmipActionReadClients   = vaultixpolicy.DefineAction[KmipSubject]("read-clients")
	KmipActionGenerateCerts = vaultixpolicy.DefineAction[KmipSubject]("generate-client-certificates")
)

// SecretScanningDataSource actions (ProjectPermissionSecretScanningDataSourceActions)
var (
	SecretScanningDataSourceActionRead          = vaultixpolicy.DefineAction[SecretScanningDataSourcesSubject]("read-data-sources")
	SecretScanningDataSourceActionCreate        = vaultixpolicy.DefineAction[SecretScanningDataSourcesSubject]("create-data-sources")
	SecretScanningDataSourceActionEdit          = vaultixpolicy.DefineAction[SecretScanningDataSourcesSubject]("edit-data-sources")
	SecretScanningDataSourceActionDelete        = vaultixpolicy.DefineAction[SecretScanningDataSourcesSubject]("delete-data-sources")
	SecretScanningDataSourceActionTriggerScans  = vaultixpolicy.DefineAction[SecretScanningDataSourcesSubject]("trigger-data-source-scans")
	SecretScanningDataSourceActionReadScans     = vaultixpolicy.DefineAction[SecretScanningDataSourcesSubject]("read-data-source-scans")
	SecretScanningDataSourceActionReadResources = vaultixpolicy.DefineAction[SecretScanningDataSourcesSubject]("read-data-source-resources")
)

// SecretScanningFinding actions (ProjectPermissionSecretScanningFindingActions)
var (
	SecretScanningFindingActionRead   = vaultixpolicy.DefineAction[SecretScanningFindingsSubject]("read-findings")
	SecretScanningFindingActionUpdate = vaultixpolicy.DefineAction[SecretScanningFindingsSubject]("update-findings")
)

// SecretScanningConfig actions (ProjectPermissionSecretScanningConfigActions)
var (
	SecretScanningConfigActionRead   = vaultixpolicy.DefineAction[SecretScanningConfigsSubject]("read-configs")
	SecretScanningConfigActionUpdate = vaultixpolicy.DefineAction[SecretScanningConfigsSubject]("update-configs")
)

// AppConnection actions (ProjectPermissionAppConnectionActions)
var (
	AppConnectionActionRead              = vaultixpolicy.DefineAction[AppConnectionSubject]("read-app-connections")
	AppConnectionActionCreate            = vaultixpolicy.DefineAction[AppConnectionSubject]("create-app-connections")
	AppConnectionActionEdit              = vaultixpolicy.DefineAction[AppConnectionSubject]("edit-app-connections")
	AppConnectionActionDelete            = vaultixpolicy.DefineAction[AppConnectionSubject]("delete-app-connections")
	AppConnectionActionConnect           = vaultixpolicy.DefineAction[AppConnectionSubject]("connect-app-connections")
	AppConnectionActionRotateCredentials = vaultixpolicy.DefineAction[AppConnectionSubject]("rotate-credentials")
)

// PamFolders actions
var (
	PamFoldersActionRead   = vaultixpolicy.DefineAction[PamFoldersSubject]("read")
	PamFoldersActionCreate = vaultixpolicy.DefineAction[PamFoldersSubject]("create")
	PamFoldersActionEdit   = vaultixpolicy.DefineAction[PamFoldersSubject]("edit")
	PamFoldersActionDelete = vaultixpolicy.DefineAction[PamFoldersSubject]("delete")
)

// PamAccount actions (ProjectPermissionPamAccountActions)
var (
	PamAccountActionAccess = vaultixpolicy.DefineAction[PamAccountSubject]("access")
	PamAccountActionRead   = vaultixpolicy.DefineAction[PamAccountSubject]("read")
	PamAccountActionCreate = vaultixpolicy.DefineAction[PamAccountSubject]("create")
	PamAccountActionEdit   = vaultixpolicy.DefineAction[PamAccountSubject]("edit")
	PamAccountActionDelete = vaultixpolicy.DefineAction[PamAccountSubject]("delete")
)

// PamResource actions (ProjectPermissionActions on PamResourceSubject)
var (
	PamResourceActionRead   = vaultixpolicy.DefineAction[PamResourceSubject]("read")
	PamResourceActionCreate = vaultixpolicy.DefineAction[PamResourceSubject]("create")
	PamResourceActionEdit   = vaultixpolicy.DefineAction[PamResourceSubject]("edit")
	PamResourceActionDelete = vaultixpolicy.DefineAction[PamResourceSubject]("delete")
)

// PamSession actions (ProjectPermissionPamSessionActions)
var PamSessionActionRead = vaultixpolicy.DefineAction[PamSessionsSubject]("read")

// PamDiscovery actions (ProjectPermissionPamDiscoveryActions)
var (
	PamDiscoveryActionRead    = vaultixpolicy.DefineAction[PamDiscoverySubject]("read")
	PamDiscoveryActionCreate  = vaultixpolicy.DefineAction[PamDiscoverySubject]("create")
	PamDiscoveryActionEdit    = vaultixpolicy.DefineAction[PamDiscoverySubject]("edit")
	PamDiscoveryActionDelete  = vaultixpolicy.DefineAction[PamDiscoverySubject]("delete")
	PamDiscoveryActionRunScan = vaultixpolicy.DefineAction[PamDiscoverySubject]("run-scan")
)

// ApprovalRequest actions (ProjectPermissionApprovalRequestActions)
var (
	ApprovalRequestActionRead   = vaultixpolicy.DefineAction[ApprovalRequestsSubject]("read")
	ApprovalRequestActionCreate = vaultixpolicy.DefineAction[ApprovalRequestsSubject]("create")
)

// ApprovalRequestGrant actions (ProjectPermissionApprovalRequestGrantActions)
var (
	ApprovalRequestGrantActionRead   = vaultixpolicy.DefineAction[ApprovalRequestGrantsSubject]("read")
	ApprovalRequestGrantActionRevoke = vaultixpolicy.DefineAction[ApprovalRequestGrantsSubject]("revoke")
)
