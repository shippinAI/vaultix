// Vaultix table namespaces: every table is vx_<group>_<entity>, grouped by product domain.
// This is the single rule set; scripts/map-table-namespaces.mjs renders it into
// docs/schema/table-namespaces.json and the TypeScript and Go constants.

export const TABLE_PREFIX = "vx";

// Group order is also the order of docs/schema/table-namespaces.json.
export const TABLE_GROUPS = {
  auth: "People signing in: users, sessions, MFA, SSO configuration, API keys",
  identity: "Machine identities and their authentication methods",
  workspace: "Organizations, projects, environments, memberships, roles and groups",
  secrets: "Secrets, folders, versions, snapshots, imports, tags, rotation and dynamic secrets",
  policy: "Approval policies and requests, access requests and validation rules",
  connect: "App connections, syncs, integrations, webhooks, migrations and proxied services",
  net: "Gateways, relays and resource authentication for network access",
  pki: "Certificate authorities, certificates, profiles, enrollment and SSH certificates",
  kms: "Key management, external KMS, HSM and KMIP",
  pam: "Privileged access management",
  scan: "Secret scanning",
  ai: "AI and MCP servers, endpoints and activity",
  operate: "Audit logs, notifications, alerts, queues and instance configuration",
  public: "Public, pre-sign-in surfaces such as early-access requests"
};

// Tables created by raw SQL that the TypeScript TableName list never named. The knex
// migration bookkeeping tables (vaultix_migrations*) are infrastructure and keep their names.
export const RAW_LEGACY_TABLES = [
  "vaultix_device_authorizations",
  "vaultix_device_sessions",
  "vaultix_device_session_events",
  "vaultix_device_event_deliveries",
  "vaultix_identity_bindings",
  "vaultix_identity_binding_events",
  "vaultix_identity_link_challenges",
  "vaultix_identity_reauth_attempts",
  "vaultix_identity_reauth_proofs",
  "vaultix_identity_reauth_totp",
  "vaultix_totp_replays",
  "pam_revamp_backup"
];

// Explicit placements. Everything else is placed by GROUP_RULES below.
const EXPLICIT = {
  vaultix_device_authorizations: ["auth", "device_authorizations"],
  vaultix_device_sessions: ["auth", "device_sessions"],
  vaultix_device_session_events: ["auth", "device_session_events"],
  vaultix_device_event_deliveries: ["auth", "device_event_deliveries"],
  vaultix_identity_bindings: ["auth", "identity_bindings"],
  vaultix_identity_binding_events: ["auth", "identity_binding_events"],
  vaultix_identity_link_challenges: ["auth", "identity_link_challenges"],
  vaultix_identity_reauth_attempts: ["auth", "reauth_attempts"],
  vaultix_identity_reauth_proofs: ["auth", "reauth_proofs"],
  vaultix_identity_reauth_totp: ["auth", "reauth_totp"],
  vaultix_totp_replays: ["auth", "totp_replays"],
  pam_revamp_backup: ["pam", "legacy_revamp_backup"],

  users: ["auth", "users"],
  user_aliases: ["auth", "user_aliases"],
  user_encryption_keys: ["auth", "user_encryption_keys"],
  user_actions: ["auth", "user_actions"],
  user_secret_activation: ["auth", "user_secret_activation"],
  user_mfa_recovery_codes: ["auth", "mfa_recovery_codes"],
  totp_configs: ["auth", "totp_configs"],
  webauthn_credentials: ["auth", "webauthn_credentials"],
  auth_tokens: ["auth", "tokens"],
  auth_token_sessions: ["auth", "sessions"],
  backup_private_key: ["auth", "backup_private_keys"],
  signup_onboarding_responses: ["auth", "signup_onboarding_responses"],
  saml_configs: ["auth", "saml_configs"],
  ldap_configs: ["auth", "ldap_configs"],
  oidc_configs: ["auth", "oidc_configs"],
  ldap_group_maps: ["auth", "ldap_group_maps"],
  scim_tokens: ["auth", "scim_tokens"],
  scim_events: ["auth", "scim_events"],
  trusted_ips: ["auth", "trusted_ips"],
  oauth_clients: ["auth", "oauth_clients"],
  api_keys: ["auth", "api_keys"],
  email_domains: ["auth", "email_domains"],
  external_group_org_role_mappings: ["auth", "external_group_role_mappings"],

  identities: ["identity", "identities"],
  service_tokens: ["identity", "service_tokens"],
  identity_group_membership: ["identity", "group_memberships"],
  resource_metadata: ["identity", "resource_metadata"],

  organizations: ["workspace", "organizations"],
  org_memberships: ["workspace", "org_memberships"],
  org_roles: ["workspace", "org_roles"],
  org_bots: ["workspace", "org_bots"],
  organization_assets: ["workspace", "org_assets"],
  incident_contacts: ["workspace", "incident_contacts"],
  projects: ["workspace", "projects"],
  project_bots: ["workspace", "project_bots"],
  project_environments: ["workspace", "environments"],
  project_memberships: ["workspace", "project_memberships"],
  project_roles: ["workspace", "project_roles"],
  project_user_additional_privilege: ["workspace", "project_user_additional_privileges"],
  project_user_membership_roles: ["workspace", "project_user_membership_roles"],
  project_keys: ["workspace", "project_keys"],
  project_templates: ["workspace", "project_templates"],
  project_template_user_memberships: ["workspace", "project_template_user_memberships"],
  project_template_group_memberships: ["workspace", "project_template_group_memberships"],
  project_template_identity_memberships: ["workspace", "project_template_identity_memberships"],
  project_split_backfill_ids: ["workspace", "project_split_backfill_ids"],
  groups: ["workspace", "groups"],
  group_project_memberships: ["workspace", "group_project_memberships"],
  group_project_membership_roles: ["workspace", "group_project_membership_roles"],
  user_group_membership: ["workspace", "user_group_memberships"],
  memberships: ["workspace", "memberships"],
  membership_roles: ["workspace", "membership_roles"],
  roles: ["workspace", "roles"],
  additional_privileges: ["workspace", "additional_privileges"],
  namespaces: ["workspace", "namespaces"],

  secrets: ["secrets", "legacy_secrets"],
  secrets_v2: ["secrets", "secrets"],
  secret_versions: ["secrets", "legacy_versions"],
  secret_versions_v2: ["secrets", "versions"],
  secret_references: ["secrets", "legacy_references"],
  secret_references_v2: ["secrets", "references"],
  secret_snapshot_secrets: ["secrets", "legacy_snapshot_secrets"],
  secret_snapshot_secrets_v2: ["secrets", "snapshot_secrets"],
  secret_tag_junction: ["secrets", "legacy_tag_junction"],
  secret_v2_tag_junction: ["secrets", "tag_junction"],
  secret_version_tag_junction: ["secrets", "legacy_version_tag_junction"],
  secret_version_v2_tag_junction: ["secrets", "version_tag_junction"],
  secret_blind_indexes: ["secrets", "legacy_blind_indexes"],
  secret_rotations: ["secrets", "legacy_rotations"],
  secret_rotation_outputs: ["secrets", "legacy_rotation_outputs"],
  secret_rotation_output_v2: ["secrets", "legacy_rotation_outputs_v2"],
  secret_rotations_v2: ["secrets", "rotations"],
  secret_rotation_v2_secret_mappings: ["secrets", "rotation_secret_mappings"],
  project_folder_grants: ["secrets", "folder_grants"],
  dynamic_secrets: ["secrets", "dynamic_secrets"],
  dynamic_secret_leases: ["secrets", "dynamic_secret_leases"],
  honey_token_configs: ["secrets", "honey_token_configs"],
  honey_tokens: ["secrets", "honey_tokens"],
  honey_token_events: ["secrets", "honey_token_events"],
  honey_token_secret_mappings: ["secrets", "honey_token_secret_mappings"],
  reminders: ["secrets", "reminders"],
  reminders_recipients: ["secrets", "reminder_recipients"],
  secret_reminder_recipients: ["secrets", "legacy_reminder_recipients"],
  secret_sharing: ["secrets", "shares"],

  project_access_requests: ["policy", "access_requests"],
  secret_validation_rules: ["policy", "secret_validation_rules"],

  app_connections: ["connect", "app_connections"],
  app_connection_credential_rotations: ["connect", "app_connection_credential_rotations"],
  integrations: ["connect", "legacy_integrations"],
  integration_auths: ["connect", "legacy_integration_auths"],
  secret_syncs: ["connect", "secret_syncs"],
  pki_syncs: ["connect", "pki_syncs"],
  certificate_syncs: ["connect", "certificate_syncs"],
  webhooks: ["connect", "webhooks"],
  workflow_integrations: ["connect", "workflow_integrations"],
  slack_integrations: ["connect", "slack_integrations"],
  project_slack_configs: ["connect", "slack_project_configs"],
  microsoft_teams_integrations: ["connect", "teams_integrations"],
  project_microsoft_teams_configs: ["connect", "teams_project_configs"],
  external_migration_configs: ["connect", "migration_configs"],
  vault_external_migration_configs: ["connect", "vault_migration_configs"],
  proxied_services: ["connect", "proxied_services"],
  proxied_service_credentials: ["connect", "proxied_service_credentials"],
  org_agent_proxy_config: ["connect", "agent_proxy_configs"],

  gateways: ["net", "legacy_gateways"],
  gateways_v2: ["net", "gateways"],
  project_gateways: ["net", "project_gateways"],
  org_gateway_config: ["net", "legacy_gateway_configs"],
  org_gateway_config_v2: ["net", "gateway_configs"],
  gateway_pools: ["net", "gateway_pools"],
  gateway_pool_memberships: ["net", "gateway_pool_memberships"],
  relays: ["net", "relays"],
  instance_relay_config: ["net", "instance_relay_configs"],
  org_relay_config: ["net", "org_relay_configs"],
  resource_auth_methods: ["net", "resource_auth_methods"],
  resource_aws_auths: ["net", "resource_aws_auths"],
  resource_token_auths: ["net", "resource_token_auths"],

  certificates: ["pki", "certificates"],
  project_ssh_configs: ["pki", "ssh_project_configs"],
  ca_signing_configs: ["pki", "ca_signing_configs"],

  hsm_connectors: ["kms", "hsm_connectors"],
  external_kms: ["kms", "external"],
  internal_kms: ["kms", "internal"],
  internal_kms_key_version: ["kms", "internal_key_versions"],

  audit_logs: ["operate", "audit_logs"],
  audit_log_streams: ["operate", "audit_log_streams"],
  audit_log_stream_outbox: ["operate", "audit_log_stream_outbox"],
  audit_reports: ["operate", "audit_reports"],
  user_notifications: ["operate", "notifications"],
  alerts: ["operate", "alerts"],
  alert_channels: ["operate", "alert_channels"],
  alert_channel_recipients: ["operate", "alert_channel_recipients"],
  alert_channel_memberships: ["operate", "alert_channel_memberships"],
  alert_history: ["operate", "alert_history"],
  alert_history_target: ["operate", "alert_history_targets"],
  queue_jobs: ["operate", "queue_jobs"],
  key_value_store: ["operate", "key_value_store"],
  super_admin: ["operate", "instance_config"],
  rate_limit: ["operate", "rate_limits"],

  vaultix_early_access_requests: ["public", "early_access_requests"]
};

// Prefix rules for the rest, first match wins. The matched stem is dropped from the entity.
const GROUP_RULES = [
  [/^identity_/, "identity"],
  [/^(access_approval_|secret_approval_|approval_)/, "policy", false],
  [/^secret_scanning_/, "scan"],
  [/^secret_/, "secrets"],
  [/^folder_/, "secrets", false],
  [/^(pki_|certificate_|ssh_|external_certificate_|internal_certificate_)/, "pki", false],
  [/^(kms_|kmip_)/, "kms", false],
  [/^pam_/, "pam"],
  [/^ai_/, "ai"],
  [/^(git_app_|github_)/, "connect", false]
];

const stripPki = entity => entity.replace(/^pki_/, "");
const stripKms = entity => entity.replace(/^kms_/, "");

export function placeTable(legacy) {
  if (EXPLICIT[legacy]) return EXPLICIT[legacy];
  for (const [pattern, group, strip = true] of GROUP_RULES) {
    if (!pattern.test(legacy)) continue;
    let entity = strip ? legacy.replace(pattern, "") : legacy;
    if (group === "pki") entity = stripPki(entity);
    if (group === "kms") entity = stripKms(entity);
    return [group, entity];
  }
  return null;
}

export function namespaceTables(legacyNames) {
  const rows = [];
  const unplaced = [];
  for (const legacy of legacyNames) {
    const placed = placeTable(legacy);
    if (!placed) { unplaced.push(legacy); continue; }
    const [group, entity] = placed;
    rows.push({ legacy, group, entity, name: `${TABLE_PREFIX}_${group}_${entity}` });
  }
  const seen = new Map();
  const collisions = [];
  for (const row of rows) {
    if (seen.has(row.name)) collisions.push([seen.get(row.name), row.legacy, row.name]);
    seen.set(row.name, row.legacy);
  }
  const tooLong = rows.filter(row => row.name.length > 63).map(row => row.name);
  return { rows, unplaced, collisions, tooLong };
}
