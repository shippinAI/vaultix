import type { Knex } from "knex";

import { RecordedOperation } from "../recorded-operation";

// Narrow the untyped Knex client boundary to the pinned PostgreSQL/Tarn methods
// this adapter owns. Real pool contention and connection disposal are tested.
type RecordedClient = {
  pool: { acquire: () => { promise: Promise<object>; abort: () => void } };
  destroyRawConnection: (connection: object) => Promise<void>;
  releaseConnection: (connection: object) => Promise<void>;
};

// Knex's PostgreSQL query cancellation opens another raw connection. This path
// instead owns one acquired connection and closes it on cancellation. A shared
// pool may finish creating an unused resource after an acquisition is aborted;
// no transaction or application query is started by that abandoned acquisition.
export const withRecordedTransaction = async <T>(
  db: Knex,
  operation: RecordedOperation,
  work: (tx: Knex) => Promise<T>
): Promise<T> => {
  operation.remainingMs();
  const client = db.client as RecordedClient;
  const acquisition = client.pool.acquire();
  const abortAcquisition = () => acquisition.abort();
  operation.signal.addEventListener("abort", abortAcquisition, { once: true });
  if (operation.signal.aborted) abortAcquisition();
  let connection: object;
  try {
    connection = await acquisition.promise;
  } finally {
    operation.signal.removeEventListener("abort", abortAcquisition);
  }
  let closing: Promise<unknown> | undefined;
  const close = () => {
    // Disposed connections must never be handed to the next pool borrower.
    Reflect.set(connection, "__knex__disposed", true);
    closing ??= client.destroyRawConnection(connection);
    // Attach a rejection handler immediately; the finally block still awaits it.
    void closing.catch(() => {});
  };
  operation.signal.addEventListener("abort", close, { once: true });
  try {
    if (operation.signal.aborted) close();
    operation.remainingMs();
    return await db.transaction(
      async (tx) => {
        const timeout = String(Math.min(5000, operation.remainingMs()));
        await tx.raw(
          "SELECT set_config('statement_timeout', ?, true), set_config('idle_in_transaction_session_timeout', ?, true)",
          [timeout, timeout]
        );
        const result = await work(tx);
        operation.remainingMs();
        return result;
      },
      { connection }
    );
  } finally {
    operation.signal.removeEventListener("abort", close);
    try {
      await closing;
    } finally {
      await client.releaseConnection(connection);
    }
  }
};
