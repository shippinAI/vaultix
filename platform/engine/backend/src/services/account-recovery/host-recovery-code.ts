import { createHash, timingSafeEqual } from "node:crypto";
import { lstat, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ForbiddenRequestError } from "@app/lib/errors";

// Owner recovery from the host (docs/0109, docs/0122 Stage 3). `vaultix server owner-reset-link`
// writes a fresh code into this file from inside the running container and presents it at once.
// Writing here needs command access to the container, which already controls the instance, so the
// file is the proof; nothing reachable over the network can create it. The code works once.
export const HOST_RECOVERY_FILE_NAME = "vaultix-host-recovery";
export const HOST_RECOVERY_CODE_LIFETIME_MS = 5 * 60_000;
const MIN_CODE_LENGTH = 32;
const MAX_CODE_BYTES = 256;

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

const refused = () =>
  new ForbiddenRequestError({
    name: "HostRecoveryRequired",
    message:
      "Owner recovery starts on the server that runs this instance: run 'vaultix server owner-reset-link --directory DIR' there."
  });

export const consumeHostRecoveryCode = async (
  presented: string,
  { directory = tmpdir(), now = Date.now() }: { directory?: string; now?: number } = {}
) => {
  const file = join(directory, HOST_RECOVERY_FILE_NAME);
  const info = await lstat(file).catch(() => null);
  if (!info) throw refused();
  // Removed before comparing, so a wrong guess also spends the code.
  const stored = info.isFile() && info.size <= MAX_CODE_BYTES ? await readFile(file, "utf8").catch(() => "") : "";
  await unlink(file).catch(() => undefined);
  const code = stored.trim();
  const fresh = info.mtimeMs <= now + 60_000 && now - info.mtimeMs <= HOST_RECOVERY_CODE_LIFETIME_MS;
  if (!fresh || code.length < MIN_CODE_LENGTH || !timingSafeEqual(digest(code), digest(presented.trim()))) {
    throw refused();
  }
};
