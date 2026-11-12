import { describe, expect, test } from "vitest";

import { ForbiddenRequestError } from "@app/lib/errors";

import { assertSelfServiceOrgCreationAllowed } from "./org-creation-policy";

describe("self-service organization creation", () => {
  test.each([
    { allowSignUp: true, superAdmin: false },
    { allowSignUp: true, superAdmin: null },
    { allowSignUp: false, superAdmin: true },
    { allowSignUp: null, superAdmin: true }
  ])("allows $allowSignUp signup with $superAdmin administrator", (actor) => {
    expect(() => assertSelfServiceOrgCreationAllowed(actor)).not.toThrow();
  });

  // The signup router treats a null setting as closed, so this policy must agree.
  test.each([
    { allowSignUp: false, superAdmin: false },
    { allowSignUp: false, superAdmin: null },
    { allowSignUp: false },
    { allowSignUp: null, superAdmin: false },
    {}
  ])("denies an ordinary user when signup is closed: %j", (actor) => {
    expect(() => assertSelfServiceOrgCreationAllowed(actor)).toThrow(ForbiddenRequestError);
    expect(() => assertSelfServiceOrgCreationAllowed(actor)).toThrow(/invite-only/);
  });
});
