import type { Knex } from "knex";
import { validate as isUuid } from "uuid";

import { TDbClient } from "@app/db";
import { withRecordedTransaction } from "@app/lib/knex/recorded-transaction";
import { RecordedOperation } from "@app/lib/recorded-operation";

export type DeviceNoticeRecipient = {
  userId: string;
  orgId: string;
  email: string | null;
};

type Audience = { orgId: string; rootOrgId: string; subjectId: string };
type Page = Audience & { after?: string | null; limit?: number };

const validAudience = (audience: Audience) => {
  if (![audience.orgId, audience.rootOrgId, audience.subjectId].every(isUuid)) {
    throw new Error("Invalid device notice audience");
  }
};

export const deviceEventRecipientDALFactory = (db: TDbClient) => {
  const administrators = async (
    page: Page,
    recipientId?: string,
    tx?: Knex,
    operation?: RecordedOperation
  ): Promise<DeviceNoticeRecipient[]> => {
    operation?.remainingMs();
    validAudience(page);
    const limit = page.limit ?? 40;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 40 ||
      (page.after != null && !isUuid(page.after)) ||
      (recipientId !== undefined && !isUuid(recipientId))
    ) {
      throw new Error("Invalid device notice recipient page");
    }
    const execute = async (connection: Knex) => {
      const result = await connection.raw<{ rows: DeviceNoticeRecipient[] }>(
        `WITH scope AS MATERIALIZED (
          SELECT selected.id, root.id AS root_id FROM organizations selected
          JOIN organizations root ON root.id=COALESCE(selected."rootOrgId",selected.id)
          WHERE selected.id=?::uuid AND root.id=?::uuid
            AND COALESCE(root."rootOrgId",root.id)=root.id
        ), stamp AS MATERIALIZED (SELECT clock_timestamp() AS now),
        admin_memberships AS MATERIALIZED (
          SELECT m."actorUserId",m."actorGroupId",m."scopeOrgId",s.root_id
          FROM memberships m CROSS JOIN scope s CROSS JOIN stamp
          WHERE m.scope='organization' AND m."scopeOrgId" IN (s.id,s.root_id)
            AND m."isActive" AND (m.status IS NULL OR m.status='accepted')
            AND EXISTS (SELECT 1 FROM membership_roles r WHERE r."membershipId"=m.id
              AND r.role='admin' AND (NOT r."isTemporary" OR
                (r."temporaryAccessStartTime"<=stamp.now AND r."temporaryAccessEndTime">stamp.now)))
        ), candidates AS (
          SELECT m."actorUserId" AS user_id,m."scopeOrgId" AS org_id,m.root_id
          FROM admin_memberships m WHERE m."actorUserId" IS NOT NULL
          UNION
          SELECT ug."userId",m."scopeOrgId",m.root_id FROM admin_memberships m
          JOIN groups g ON g.id=m."actorGroupId" AND g."orgId"=m.root_id
          JOIN user_group_membership ug ON ug."groupId"=g.id AND NOT ug."isPending"
        ), eligible AS (
          SELECT c.user_id,c.org_id,u.email FROM candidates c JOIN users u ON u.id=c.user_id
          WHERE u."isAccepted" AND NOT u."isGhost" AND c.user_id<>?::uuid
            AND (?::uuid IS NULL OR c.user_id>?::uuid)
            AND (?::uuid IS NULL OR c.user_id=?::uuid)
            AND NOT EXISTS (SELECT 1 FROM memberships direct
              WHERE direct.scope='organization' AND direct."scopeOrgId"=c.org_id
                AND direct."actorUserId"=c.user_id
                AND (NOT direct."isActive" OR (direct.status IS NOT NULL AND direct.status<>'accepted')))
            AND (c.root_id=?::uuid OR EXISTS (SELECT 1 FROM memberships root_member
              WHERE root_member.scope='organization' AND root_member."scopeOrgId"=c.root_id
                AND root_member."actorUserId"=c.user_id AND root_member."isActive"
                AND (root_member.status IS NULL OR root_member.status='accepted')))
        ), routed AS (
          SELECT DISTINCT ON (user_id) user_id,org_id,email FROM eligible
          ORDER BY user_id,(org_id=?::uuid) DESC,org_id
        ) SELECT user_id AS "userId",org_id AS "orgId",email FROM routed
          ORDER BY user_id LIMIT ?`,
        [
          page.orgId,
          page.rootOrgId,
          page.subjectId,
          page.after ?? null,
          page.after ?? null,
          recipientId ?? null,
          recipientId ?? null,
          page.orgId,
          page.orgId,
          limit + 1
        ]
      );
      return result.rows;
    };
    if (tx) return execute(tx);
    if (operation) return withRecordedTransaction(db, operation, execute);
    return db.transaction(async (connection) => {
      await connection.raw("SET LOCAL statement_timeout = '5s'");
      return execute(connection);
    });
  };

  const listAdministrators = async (page: Page, operation?: RecordedOperation) => {
    const limit = page.limit ?? 40;
    const rows = await administrators(page, undefined, undefined, operation);
    const recipients = rows.slice(0, limit);
    return { recipients, next: rows.length > limit ? recipients[recipients.length - 1].userId : null };
  };

  const findRecipient = async (
    audience: Audience & { userId: string; kind: "subject" | "administrator" },
    tx?: Knex,
    operation?: RecordedOperation
  ): Promise<DeviceNoticeRecipient | undefined> => {
    operation?.remainingMs();
    validAudience(audience);
    if (!isUuid(audience.userId)) throw new Error("Invalid device notice recipient");
    if (audience.kind === "administrator") {
      const [recipient] = await administrators({ ...audience, limit: 1 }, audience.userId, tx, operation);
      return recipient;
    }
    if (audience.kind !== "subject" || audience.userId !== audience.subjectId) return undefined;
    // Account security notices remain available to a locked account. They do not
    // grant that account a session or access to an organization's resources.
    const execute = async (connection: Knex) =>
      connection("users")
        .where({ id: audience.userId, isAccepted: true, isGhost: false })
        .first<DeviceNoticeRecipient>("id as userId", "email", connection.raw('?::uuid AS "orgId"', [audience.orgId]));
    if (tx) return execute(tx);
    return operation ? withRecordedTransaction(db, operation, execute) : execute(db);
  };

  return { listAdministrators, findRecipient };
};
