import { describe, expect, test } from "vitest";

import { findStaleApprovedKeys, isImportProvider, planProviderImport } from "./provider-import";

const source = [
  { secretKey: "B_EXISTS", secretValue: "b" },
  { secretKey: "A_NEW", secretValue: "a" },
  { secretKey: "C_HIDDEN", secretValue: "", valueHidden: true },
  { secretKey: "D_DENIED", secretValue: "d" },
  { secretKey: "A_NEW", secretValue: "duplicate" },
  { secretKey: "", secretValue: "ignored" }
];

describe("provider import plan", () => {
  const plan = planProviderImport({
    source,
    existingKeys: ["B_EXISTS"],
    canCreate: (key) => key !== "D_DENIED"
  });

  test("classifies every source key once, sorted", () => {
    expect(plan.keys).toEqual([
      { key: "A_NEW", action: "create" },
      { key: "B_EXISTS", action: "exists" },
      { key: "C_HIDDEN", action: "unreadable" },
      { key: "D_DENIED", action: "denied" }
    ]);
    expect(plan).toMatchObject({ sourceCount: 4, createCount: 1, existingCount: 1 });
  });

  test("never carries a value", () => {
    expect(JSON.stringify(plan)).not.toMatch(/"(a|b|d|duplicate|ignored)"/);
  });

  test("approved keys must still be creatable", () => {
    expect(findStaleApprovedKeys(plan, ["A_NEW", "A_NEW"])).toEqual([]);
    expect(findStaleApprovedKeys(plan, ["A_NEW", "B_EXISTS", "C_HIDDEN", "GONE"])).toEqual([
      "B_EXISTS",
      "C_HIDDEN",
      "GONE"
    ]);
  });

  test("an existing key wins over hidden or denied", () => {
    const existing = planProviderImport({
      source: [{ secretKey: "K", secretValue: "", valueHidden: true }],
      existingKeys: ["K"],
      canCreate: () => false
    });
    expect(existing.keys).toEqual([{ key: "K", action: "exists" }]);
  });

  test("only the two providers are importable", () => {
    expect(isImportProvider("doppler")).toBe(true);
    expect(isImportProvider("external-vaultix")).toBe(true);
    expect(isImportProvider("hashicorp-vault")).toBe(false);
  });
});
