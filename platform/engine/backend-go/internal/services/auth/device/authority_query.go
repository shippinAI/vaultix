package device

// Only authorization inputs enter this snapshot. Names, usage timestamps,
// credential values and unrelated profile edits cannot invalidate an approval.
// Ordered JSONB arrays make the digest stable across query plans and replicas.
const devicePolicyQuery = `
WITH stamp AS MATERIALIZED (SELECT clock_timestamp() AS now),
orgs AS MATERIALIZED (
 SELECT id,COALESCE("rootOrgId",id) AS "rootId",COALESCE("authEnforced",false) AS "authEnforced",
 "googleSsoAuthEnforced" AS google,"bypassOrgAuthEnabled" AS "bypassEnabled",
 "enforceMfa" AS mfa,COALESCE("selectedMfaMethod",'') AS "mfaMethod","userTokenExpiration" AS "tokenExpiration"
 FROM vx_workspace_organizations WHERE id IN (@org,@root)
),
members AS MATERIALIZED (
 SELECT membership.id,membership."scopeOrgId" AS "orgId",
 COALESCE(membership."actorUserId"=@user,false) AS direct,membership."isActive" AS active,membership.status
 FROM vx_workspace_memberships membership WHERE membership.scope='organization' AND membership."scopeOrgId" IN (@org,@root)
 AND (membership."actorUserId"=@user OR EXISTS (
 SELECT 1 FROM vx_workspace_user_group_memberships ugm WHERE ugm."userId"=@user AND ugm."groupId"=membership."actorGroupId"))
),
member_roles AS MATERIALIZED (
 SELECT member_role.id,members."orgId",member_role.role,custom_role.permissions::text AS permissions,
 (NOT COALESCE(member_role."isTemporary",false) OR member_role."temporaryAccessEndTime">=stamp.now) IS TRUE AS active
 FROM members JOIN vx_workspace_membership_roles member_role ON member_role."membershipId"=members.id
 LEFT JOIN vx_workspace_roles custom_role ON custom_role.id=member_role."customRoleId" CROSS JOIN stamp
 WHERE members.active AND (members.status IS NULL OR members.status='accepted')
),
all_roles AS (
 SELECT 'membership' AS kind,id,"orgId",role,permissions,active FROM member_roles
 UNION ALL
 SELECT 'additional',privilege.id,privilege."orgId",'custom',privilege.permissions::text,
 (NOT COALESCE(privilege."isTemporary",false) OR privilege."temporaryAccessEndTime">=stamp.now) IS TRUE
 FROM vx_workspace_additional_privileges privilege CROSS JOIN stamp
 WHERE privilege."actorUserId"=@user AND privilege."orgId" IN (@org,@root)
 AND EXISTS (SELECT 1 FROM member_roles WHERE member_roles."orgId"=privilege."orgId")
),
factors AS (
 SELECT factor.id,encode(sha256(factor."encryptedSecret"),'hex') AS fingerprint
 FROM vx_auth_totp_configs factor WHERE @mfaMethod='totp' AND factor."userId"=@user AND factor."isVerified"
 UNION ALL
 SELECT credential.id,credential."publicKey" FROM vx_auth_webauthn_credentials credential
 WHERE @mfaMethod='webauthn' AND credential."userId"=@user
)
SELECT jsonb_build_object(
 'userMfa',COALESCE(usr."isMfaEnabled",false),'userMfaMethod',COALESCE(usr."selectedMfaMethod",''),
 'emailVerified',COALESCE(usr."isEmailVerified",false),
 'emailFactor',CASE WHEN @mfaMethod='email' THEN encode(sha256(convert_to(COALESCE(usr.email,''),'UTF8')),'hex') ELSE NULL END,
 'organizations',COALESCE((SELECT jsonb_agg(to_jsonb(orgs) ORDER BY id) FROM orgs),'[]'::jsonb),
 'memberships',COALESCE((SELECT jsonb_agg(to_jsonb(members) ORDER BY id) FROM members),'[]'::jsonb),
 'roles',COALESCE((SELECT jsonb_agg(to_jsonb(all_roles) ORDER BY kind,id) FROM all_roles),'[]'::jsonb),
 'factors',COALESCE((SELECT jsonb_agg(to_jsonb(factors) ORDER BY id) FROM factors),'[]'::jsonb)
) FROM vx_auth_users usr WHERE usr.id=@user
`
