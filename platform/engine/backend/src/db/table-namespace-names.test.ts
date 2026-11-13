import { describe, expect, test } from "vitest";

import { inheritedTableName, makeObjectName, MAX_IDENTIFIER } from "./table-namespace-names";
import { LEGACY_TABLE_RENAMES } from "./table-namespaces";

describe("table namespace names", () => {
  test("generated names match PostgreSQL's makeObjectName", () => {
    expect(makeObjectName("vx_auth_users", undefined, "pkey")).toBe("vx_auth_users_pkey");
    expect(makeObjectName("vx_pki_certificate_profiles", "enrollmentType", "check")).toBe(
      "vx_pki_certificate_profiles_enrollmentType_check"
    );
    // The longer part loses characters first, one at a time, until the name fits 63.
    expect(makeObjectName("a".repeat(60), "col", "key")).toBe(`${"a".repeat(55)}_col_key`);
    expect(makeObjectName("a".repeat(40), "b".repeat(40), "idx")).toBe(`${"a".repeat(29)}_${"b".repeat(29)}_idx`);
    expect(makeObjectName("a".repeat(40), "b".repeat(40), "idx")).toHaveLength(MAX_IDENTIFIER);
  });

  test("every vx_ table maps back to its inherited name and fits its updatedAt trigger", () => {
    for (const [legacy, current] of LEGACY_TABLE_RENAMES) {
      expect(inheritedTableName(current)).toBe(legacy);
      expect(`${current}_updatedAt`.length).toBeLessThanOrEqual(MAX_IDENTIFIER);
    }
    expect(inheritedTableName("vx_new_table_after_rename")).toBe("vx_new_table_after_rename");
  });
});
