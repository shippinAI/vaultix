import { createHash, timingSafeEqual } from "node:crypto";

import { ForbiddenRequestError } from "@app/lib/errors";

// First-owner setup is closed by the instance's initialized flag. Until then, an instance
// installed with a setup code accepts first-owner signup or bootstrap only with that code.
export const isSetupCodeRequired = (configuredCode: string | undefined, initialized: boolean | null | undefined) =>
  Boolean(configuredCode) && !initialized;

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

export const assertSetupCode = (configuredCode: string | undefined, presented: string | undefined) => {
  if (!configuredCode) return;
  // Compare fixed-length digests so neither the length nor the content leaks through timing.
  if (!presented || !timingSafeEqual(digest(configuredCode), digest(presented.trim()))) {
    throw new ForbiddenRequestError({
      name: "SetupCodeRequired",
      message: "A valid setup code is required to create the first owner of this instance."
    });
  }
};
