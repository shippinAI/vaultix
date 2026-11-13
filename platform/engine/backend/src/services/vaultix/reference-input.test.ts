import { parseReferenceQuery } from "./reference-input";

const scope = { projectId: "11111111-1111-4111-8111-111111111111", environment: "dev" };
describe("Vaultix reference inputs", () => {
  test("normalizes HTTP pagination with bounded defaults", () => {
    expect(parseReferenceQuery(scope)).toEqual({ ...scope, secretPath: "/", offset: 0, limit: 50 });
    expect(parseReferenceQuery({ ...scope, offset: "50", limit: "100" })).toMatchObject({ offset: 50, limit: 100 });
  });
  test.each([
    { secretValue: "CANARY" },
    { orgId: "CANARY" },
    { actorId: "CANARY" },
    { viewSecretValue: true },
    { projectId: "bad" },
    { environment: "dev\n" },
    { secretPath: "/../prod" },
    { secretPath: "/a\\b" },
    { limit: 101 },
    { limit: 0 },
    { limit: true },
    { offset: -1 },
    { offset: "1e3" },
    { offset: 1000001 }
  ])("rejects scope overrides and invalid bounds %#", (input) => {
    expect(() => parseReferenceQuery({ ...scope, ...input })).toThrow();
    try {
      parseReferenceQuery({ ...scope, ...input });
    } catch (error) {
      expect(String(error)).not.toContain("CANARY");
    }
  });
});
