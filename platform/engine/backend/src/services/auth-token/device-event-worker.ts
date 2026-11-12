import { logger } from "@app/lib/logger";
import { runRecordedOperation } from "@app/lib/recorded-operation";
import { QueueWorkerProfile } from "@app/lib/types";

import { deviceEventDeliveryDALFactory } from "./device-event-delivery-dal";
import { deviceEventDispatchFactory } from "./device-event-dispatch";
import { deviceEventPreparationFactory } from "./device-event-preparation";
import { DeviceEventUnresolvedError } from "./device-event-source";

type Dependencies = {
  enabled: boolean;
  profile: QueueWorkerProfile;
  deliveries: Pick<
    ReturnType<typeof deviceEventDeliveryDALFactory>,
    "claimPreparation" | "claimDeliveries" | "failPreparation" | "pruneSettled"
  >;
  preparation: ReturnType<typeof deviceEventPreparationFactory>;
  dispatch: ReturnType<typeof deviceEventDispatchFactory>;
};

// One preparation and one delivery slot per process. Claim only work that can
// start now; replicas share the existing primary-database SKIP LOCKED fences.
// No cache lease or second copy of the security event is introduced.
export const deviceEventWorkerFactory = ({ enabled, profile, deliveries, preparation, dispatch }: Dependencies) => {
  const eligible = enabled && (profile === QueueWorkerProfile.All || profile === QueueWorkerProfile.Standard);
  let running = false;
  let stopping: Promise<void> | undefined;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;
  let nextPruneAt = 0;
  let failures = 0;
  let preparedPages = 0;
  let handledDeliveries = 0;

  const prepareOne = async (signal: AbortSignal) => {
    const [claim] = await runRecordedOperation(5000, signal, (operation) => deliveries.claimPreparation(1, operation));
    if (!claim) return;
    try {
      if (await preparation.prepare(claim, signal)) preparedPages += 1;
    } catch (error) {
      const reason = error instanceof DeviceEventUnresolvedError ? "unresolved" : "retryable";
      await runRecordedOperation(5000, undefined, (operation) => deliveries.failPreparation(claim, reason, operation));
      if (!signal.aborted) throw new Error("Device event preparation failed");
    }
  };
  const dispatchOne = async (signal: AbortSignal) => {
    const [claim] = await runRecordedOperation(5000, signal, (operation) => deliveries.claimDeliveries(1, operation));
    if (claim && (await dispatch.dispatch(claim, signal))) handledDeliveries += 1;
  };
  const failed = () => {
    failures += 1;
    // SQL, source context, recipient addresses and SMTP diagnostics are not logs.
    logger.warn("Vaultix device security-event worker could not complete an operation; durable state is retained");
  };
  const cycle = async (signal: AbortSignal) => {
    const outcomes = await Promise.allSettled([prepareOne(signal), dispatchOne(signal)]);
    for (const outcome of outcomes) if (outcome.status === "rejected" && !signal.aborted) failed();
    if (!signal.aborted && performance.now() >= nextPruneAt) {
      nextPruneAt = performance.now() + 60000;
      try {
        // A bounded page of fully settled records only, after a full year.
        // Unresolved/exhausted/unknown records and active sessions are retained.
        await runRecordedOperation(5000, signal, (operation) => deliveries.pruneSettled(365, 100, operation));
      } catch {
        if (!signal.aborted) failed();
      }
    }
  };
  const launch = () => {
    if (!running || !controller || inFlight) return;
    const active = controller;
    const task = cycle(active.signal);
    inFlight = task;
    const finished = () => {
      if (inFlight === task) inFlight = undefined;
      if (running && controller === active) {
        timer = setTimeout(launch, 1000);
        timer.unref();
      }
    };
    void task.then(finished, () => {
      failed();
      finished();
    });
  };
  const start = () => {
    if (!eligible || running) return;
    if (stopping) throw new Error("Device event worker is still stopping");
    controller = new AbortController();
    running = true;
    launch();
  };
  const stop = (): Promise<void> => {
    if (stopping) return stopping;
    running = false;
    if (timer) clearTimeout(timer);
    timer = undefined;
    controller?.abort();
    const active = inFlight;
    // This waits for the real operations, including their short disposition
    // cleanup. Returning from a timeout race would leave resources running.
    stopping = (async () => {
      try {
        await active;
      } finally {
        stopping = undefined;
      }
    })();
    return stopping;
  };
  const status = () => ({
    enabled: eligible,
    running,
    stopping: Boolean(stopping),
    active: Boolean(inFlight),
    preparedPages,
    handledDeliveries,
    failures
  });
  return { start, stop, status };
};
