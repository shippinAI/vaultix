import handlebars from "handlebars";
import { Client } from "ldapts";
import { customAlphabet } from "nanoid";
import RE2 from "re2";
import { z } from "zod";

import { TDynamicSecrets } from "@app/db/schemas";
import { BadRequestError } from "@app/lib/errors";
import { sanitizeString } from "@app/lib/fn";
import { executeDirectoryChanges } from "@app/lib/ldap/ldif";
import { validateHandlebarTemplate } from "@app/lib/template/validate-handlebars";

import { ActorIdentityAttributes } from "../../dynamic-secret-lease/dynamic-secret-lease-types";
import { verifyHostInputValidity } from "../dynamic-secret-fns";
import { LdapCredentialType, LdapSchema, TDynamicProviderFns } from "./models";
import { generateUsername } from "./templateUtils";

const generatePassword = () => {
  const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.~!*$#";
  return customAlphabet(charset, 64)();
};

const encodePassword = (password?: string) => {
  const quotedPassword = `"${password}"`;
  const utf16lePassword = Buffer.from(quotedPassword, "utf16le");
  const base64Password = utf16lePassword.toString("base64");
  return base64Password;
};

const generateLDIF = ({
  username,
  password,
  ldifTemplate
}: {
  username: string;
  password?: string;
  ldifTemplate: string;
}): string => {
  const data = {
    Username: username,
    Password: password,
    EncodedPassword: encodePassword(password)
  };

  const renderTemplate = handlebars.compile(ldifTemplate);
  const renderedLdif = renderTemplate(data);

  return renderedLdif;
};

export const LdapProvider = (): TDynamicProviderFns => {
  const validateProviderInputs = async (inputs: unknown) => {
    const providerInputs = await LdapSchema.parseAsync(inputs);

    if (providerInputs.credentialType === LdapCredentialType.Static) {
      validateHandlebarTemplate("LDAP rotation", providerInputs.rotationLdif, {
        allowedExpressions: (val) => ["Username", "Password", "EncodedPassword"].includes(val)
      });
    } else {
      validateHandlebarTemplate("LDAP creation", providerInputs.creationLdif, {
        allowedExpressions: (val) => ["Username", "Password", "EncodedPassword"].includes(val)
      });
      validateHandlebarTemplate("LDAP revocation", providerInputs.revocationLdif, {
        allowedExpressions: (val) => ["Username"].includes(val)
      });
      if (providerInputs.rollbackLdif) {
        validateHandlebarTemplate("LDAP rollback", providerInputs.rollbackLdif, {
          allowedExpressions: (val) => ["Username", "Password", "EncodedPassword"].includes(val)
        });
      }
    }

    return providerInputs;
  };

  const $getClient = async (providerInputs: z.infer<typeof LdapSchema>): Promise<Client> => {
    let ldapHost: string;
    try {
      ldapHost = new URL(providerInputs.url).hostname;
    } catch {
      throw new BadRequestError({
        message: "Invalid LDAP URL. Expected ldap:// or ldaps:// with a parseable host."
      });
    }
    if (!ldapHost) {
      throw new BadRequestError({ message: "Invalid LDAP URL. Missing host." });
    }
    await verifyHostInputValidity({ host: ldapHost, isDynamicSecret: true });

    const client = new Client({
      url: providerInputs.url,
      connectTimeout: 15_000,
      timeout: 30_000,
      tlsOptions: {
        ...(providerInputs.ca ? { ca: providerInputs.ca } : {}),
        rejectUnauthorized: providerInputs.sslRejectUnauthorized
      }
    });
    try {
      await client.bind(providerInputs.binddn, providerInputs.bindpass);
      return client;
    } catch (error) {
      await client.unbind();
      throw error;
    }
  };

  const validateConnection = async (inputs: unknown) => {
    const providerInputs = await validateProviderInputs(inputs);
    try {
      const client = await $getClient(providerInputs);
      try {
        return client.isConnected;
      } finally {
        await client.unbind();
      }
    } catch (err) {
      const sanitizedErrorMessage = sanitizeString({
        unsanitizedString: (err as Error)?.message,
        tokens: [providerInputs.bindpass, providerInputs.binddn]
      });
      throw new BadRequestError({
        message: `Failed to connect with provider: ${sanitizedErrorMessage}`
      });
    }
  };

  const create = async (data: {
    inputs: unknown;
    usernameTemplate?: string | null;
    identity: ActorIdentityAttributes;
    dynamicSecret: TDynamicSecrets;
  }) => {
    const { inputs, usernameTemplate, identity, dynamicSecret } = data;
    const providerInputs = await validateProviderInputs(inputs);
    const client = await $getClient(providerInputs);
    try {
      if (providerInputs.credentialType === LdapCredentialType.Static) {
        const dnRegex = new RE2("^dn:\\s*(.+)", "m");
        const dnMatch = dnRegex.exec(providerInputs.rotationLdif);
        const username = dnMatch?.[1];
        if (!username) throw new BadRequestError({ message: "Username not found from Ldif" });
        const password = generatePassword();

        if (dnMatch) {
          const generatedLdif = generateLDIF({ username, password, ldifTemplate: providerInputs.rotationLdif });

          try {
            const dnArray = await executeDirectoryChanges(client, generatedLdif);

            return { entityId: username, data: { DN_ARRAY: dnArray, USERNAME: username, PASSWORD: password } };
          } catch (err) {
            const sanitizedErrorMessage = sanitizeString({
              unsanitizedString: (err as Error)?.message,
              tokens: [username, password, providerInputs.binddn, providerInputs.bindpass]
            });
            throw new BadRequestError({ message: sanitizedErrorMessage });
          }
        } else {
          throw new BadRequestError({
            message: "Invalid rotation LDIF, missing DN."
          });
        }
      } else {
        const username = await generateUsername(usernameTemplate, {
          decryptedDynamicSecretInputs: inputs,
          identity,
          dynamicSecret
        });
        const password = generatePassword();
        const generatedLdif = generateLDIF({ username, password, ldifTemplate: providerInputs.creationLdif });

        try {
          const dnArray = await executeDirectoryChanges(client, generatedLdif);

          return { entityId: username, data: { DN_ARRAY: dnArray, USERNAME: username, PASSWORD: password } };
        } catch (err) {
          if (providerInputs.rollbackLdif) {
            const rollbackLdif = generateLDIF({ username, password, ldifTemplate: providerInputs.rollbackLdif });
            await executeDirectoryChanges(client, rollbackLdif);
          }
          const sanitizedErrorMessage = sanitizeString({
            unsanitizedString: (err as Error)?.message,
            tokens: [username, password, providerInputs.binddn, providerInputs.bindpass]
          });
          throw new BadRequestError({ message: sanitizedErrorMessage });
        }
      }
    } finally {
      await client.unbind();
    }
  };

  const revoke = async (inputs: unknown, entityId: string) => {
    const providerInputs = await validateProviderInputs(inputs);
    const client = await $getClient(providerInputs);
    try {
      if (providerInputs.credentialType === LdapCredentialType.Static) {
        const dnRegex = new RE2("^dn:\\s*(.+)", "m");
        const dnMatch = dnRegex.exec(providerInputs.rotationLdif);

        if (dnMatch) {
          const username = dnMatch[1];
          const password = generatePassword();

          const generatedLdif = generateLDIF({ username, password, ldifTemplate: providerInputs.rotationLdif });

          try {
            const dnArray = await executeDirectoryChanges(client, generatedLdif);

            return { entityId: username, data: { DN_ARRAY: dnArray, USERNAME: username, PASSWORD: password } };
          } catch (err) {
            const sanitizedErrorMessage = sanitizeString({
              unsanitizedString: (err as Error)?.message,
              tokens: [username, password, providerInputs.binddn, providerInputs.bindpass]
            });
            throw new BadRequestError({ message: sanitizedErrorMessage });
          }
        } else {
          throw new BadRequestError({
            message: "Invalid rotation LDIF, missing DN."
          });
        }
      }

      const revocationLdif = generateLDIF({ username: entityId, ldifTemplate: providerInputs.revocationLdif });

      await executeDirectoryChanges(client, revocationLdif);

      return { entityId };
    } finally {
      await client.unbind();
    }
  };

  const renew = async (_inputs: unknown, entityId: string) => {
    // No renewal necessary
    return { entityId };
  };

  return {
    validateProviderInputs,
    validateConnection,
    create,
    revoke,
    renew
  };
};
