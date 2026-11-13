import { ForbiddenRequestError } from "@app/lib/errors";

type TSelfServiceOrgCreation = {
  allowSignUp?: boolean | null;
  superAdmin?: boolean | null;
};

// Closing signup makes an instance invite-only, so new tenants are reserved for instance administrators.
export const assertSelfServiceOrgCreationAllowed = ({ allowSignUp, superAdmin }: TSelfServiceOrgCreation) => {
  if (allowSignUp || superAdmin) return;

  throw new ForbiddenRequestError({
    message:
      "This Vaultix instance is invite-only. Ask an instance administrator to invite you to an organization or create one for you."
  });
};
