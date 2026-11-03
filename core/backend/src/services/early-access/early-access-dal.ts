import { Knex } from "knex";

import { TDbClient } from "@app/db";
import { TableName, TVaultixEarlyAccessRequests } from "@app/db/schemas";
import { DatabaseError } from "@app/lib/errors";
import { sanitizeSqlLikeString } from "@app/lib/fn";
import { ormify } from "@app/lib/knex";

import { TEarlyAccessListFilter, TEarlyAccessStatus, TEarlyAccessSubmission } from "./early-access-types";

export type TEarlyAccessDALFactory = ReturnType<typeof earlyAccessDALFactory>;

type TEarlyAccessReview = {
  from: TEarlyAccessStatus[];
  status: TEarlyAccessStatus;
  reviewedByUserId: string;
  invitedOrgId?: string;
};

export const earlyAccessDALFactory = (db: TDbClient) => {
  const earlyAccessOrm = ormify(db, TableName.VaultixEarlyAccessRequests);

  // A repeat request keeps the original row, including any decision already made on it.
  const insertIfNew = async (submission: TEarlyAccessSubmission) => {
    try {
      await db(TableName.VaultixEarlyAccessRequests).insert(submission).onConflict("email").ignore();
    } catch (error) {
      throw new DatabaseError({ error, name: "Insert early access request" });
    }
  };

  const countByStatus = async (status: TEarlyAccessStatus) => {
    try {
      const [row] = await db
        .replicaNode()(TableName.VaultixEarlyAccessRequests)
        .where({ status })
        .count<{ count: string }[]>("id as count");
      return Number(row?.count ?? 0);
    } catch (error) {
      throw new DatabaseError({ error, name: "Count early access requests" });
    }
  };

  const list = async ({ status, search, limit, offset }: TEarlyAccessListFilter) => {
    const filtered = () => {
      const query = db.replicaNode()(TableName.VaultixEarlyAccessRequests);
      if (status) void query.where({ status });
      if (search) {
        const term = `%${sanitizeSqlLikeString(search)}%`;
        void query.where((inner) => {
          void inner.whereILike("email", term).orWhereILike("name", term).orWhereILike("organization", term);
        });
      }
      return query;
    };
    try {
      const requests = await filtered()
        .select("*")
        .orderBy("createdAt", "desc")
        .orderBy("id", "asc")
        .limit(limit)
        .offset(offset);
      const [total] = await filtered().count<{ count: string }[]>("id as count");
      return { requests: requests as TVaultixEarlyAccessRequests[], totalCount: Number(total?.count ?? 0) };
    } catch (error) {
      throw new DatabaseError({ error, name: "List early access requests" });
    }
  };

  // The status check and the write are one statement, so a concurrent reviewer waits on the
  // row lock and then matches nothing. An empty result means someone else got there first.
  const review = async (
    id: string,
    { from, status, reviewedByUserId, invitedOrgId }: TEarlyAccessReview,
    tx?: Knex
  ) => {
    try {
      const [updated] = await (tx || db)(TableName.VaultixEarlyAccessRequests)
        .where({ id })
        .whereIn("status", from)
        .update({ status, reviewedByUserId, reviewedAt: new Date(), ...(invitedOrgId ? { invitedOrgId } : {}) })
        .returning("*");
      return updated as TVaultixEarlyAccessRequests | undefined;
    } catch (error) {
      throw new DatabaseError({ error, name: "Review early access request" });
    }
  };

  return { ...earlyAccessOrm, insertIfNew, countByStatus, list, review };
};
