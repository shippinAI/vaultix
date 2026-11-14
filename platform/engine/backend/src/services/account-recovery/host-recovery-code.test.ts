import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, test } from "vitest";

import { ForbiddenRequestError } from "@app/lib/errors";

import { consumeHostRecoveryCode, HOST_RECOVERY_FILE_NAME } from "./host-recovery-code";

const code = "a".repeat(64);
let directory = "";
const file = () => join(directory, HOST_RECOVERY_FILE_NAME);

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "vaultix-host-recovery-test-"));
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

test("the code the host just wrote works once", async () => {
  writeFileSync(file(), `${code}\n`, { mode: 0o600 });
  await expect(consumeHostRecoveryCode(code, { directory })).resolves.toBeUndefined();
  expect(existsSync(file())).toBe(false);
  await expect(consumeHostRecoveryCode(code, { directory })).rejects.toBeInstanceOf(ForbiddenRequestError);
});

test("with no file there is nothing to present", async () => {
  await expect(consumeHostRecoveryCode(code, { directory })).rejects.toThrow(/vaultix server owner-reset-link/);
});

test("a wrong guess spends the code", async () => {
  writeFileSync(file(), code);
  await expect(consumeHostRecoveryCode("b".repeat(64), { directory })).rejects.toBeInstanceOf(ForbiddenRequestError);
  expect(existsSync(file())).toBe(false);
});

test("a code older than five minutes is refused", async () => {
  writeFileSync(file(), code);
  const old = (Date.now() - 6 * 60_000) / 1000;
  utimesSync(file(), old, old);
  await expect(consumeHostRecoveryCode(code, { directory })).rejects.toBeInstanceOf(ForbiddenRequestError);
});

test("a short code is refused even when it matches", async () => {
  writeFileSync(file(), "short");
  await expect(consumeHostRecoveryCode("short", { directory })).rejects.toBeInstanceOf(ForbiddenRequestError);
});

test("a link or directory in place of the file is refused", async () => {
  const elsewhere = join(directory, "elsewhere");
  writeFileSync(elsewhere, code);
  try {
    symlinkSync(elsewhere, file());
  } catch {
    mkdirSync(file());
  }
  await expect(consumeHostRecoveryCode(code, { directory })).rejects.toBeInstanceOf(ForbiddenRequestError);
});
