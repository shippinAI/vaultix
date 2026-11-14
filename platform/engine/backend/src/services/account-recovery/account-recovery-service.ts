import { AccessScope } from "@app/db/schemas";
import { getConfig } from "@app/lib/config/env";
import { crypto } from "@app/lib/crypto/cryptography";
import { BadRequestError, NotFoundError } from "@app/lib/errors";
import { logger } from "@app/lib/logger";
import { sanitizeEmail } from "@app/lib/validator";
import { AuthMethod, AuthTokenType } from "@app/services/auth/auth-type";
import { TAuthTokenServiceFactory } from "@app/services/auth-token/auth-token-service";
import { TokenType } from "@app/services/auth-token/auth-token-types";
import { TMembershipUserDALFactory } from "@app/services/membership-user/membership-user-dal";
import { SmtpTemplates, TSmtpService } from "@app/services/smtp/smtp-service";
import { TUserDALFactory } from "@app/services/user/user-dal";

import { validatePasswordResetAuthorization } from "../auth/auth-fns";

type TAccountRecoveryServiceFactoryDep = {
  userDAL: TUserDALFactory;
  membershipUserDAL: Pick<TMembershipUserDALFactory, "find">;
  tokenService: TAuthTokenServiceFactory;
  smtpService: TSmtpService;
};

export type TAccountRecoveryServiceFactory = ReturnType<typeof accountRecoveryServiceFactory>;
const DUMMY_USER_ID = "00000000-0000-0000-0000-000000000000";
// Matches the TOKEN_EMAIL_PASSWORD_RESET lifetime in auth-token-service.
const PASSWORD_RESET_LINK_LIFETIME_MS = 86_400_000;

export const accountRecoveryServiceFactory = ({
  userDAL,
  membershipUserDAL,
  tokenService,
  smtpService
}: TAccountRecoveryServiceFactoryDep) => {
  /*
   * Account recovery flow via email. Step 1: send recovery email
   */
  const sendRecoveryEmail = async (unsanitizedUsername: string) => {
    const sendEmail = async () => {
      const username = sanitizeEmail(unsanitizedUsername);
      const user = await userDAL.findOne({ username });
      if (!user) throw new BadRequestError({ message: "Failed to find user data" });

      if (user && user.isAccepted) {
        const cfg = getConfig();

        const recipient = user.email ?? user.username;
        const hasEmailAuth = user.authMethods?.includes(AuthMethod.EMAIL);
        const substitutions: Record<string, unknown> = {
          username: user.username,
          isCloud: cfg.isCloud,
          siteUrl: cfg.SITE_URL || "",
          hasEmailAuth,
          callback_url: cfg.SITE_URL ? `${cfg.SITE_URL}/account-recovery-reset` : ""
        };

        if (!hasEmailAuth) {
          const orgMemberships = await membershipUserDAL.find({
            actorUserId: user.id,
            scope: AccessScope.Organization
          });
          const lastLoginMethod =
            orgMemberships
              .filter((membership) => membership.lastLoginAuthMethod)
              .sort((a, b) => (b.updatedAt || new Date(0)).getTime() - (a.updatedAt || new Date(0)).getTime())[0]
              ?.lastLoginAuthMethod || null;
          substitutions.lastLoginMethod = lastLoginMethod;
        }

        const token = await tokenService.createTokenForUser({
          type: TokenType.TOKEN_EMAIL_PASSWORD_RESET,
          userId: user.id
        });

        substitutions.token = token;
        await smtpService.sendMail({
          template: SmtpTemplates.ResetPassword,
          recipients: [recipient],
          subjectLine: "Vaultix account recovery",
          substitutions
        });
      }
    };

    // note(daniel): run in background to prevent timing attacks
    void sendEmail().catch((err) => logger.error(err, "Failed to send account recovery email"));
  };

  /*
   * Account recovery flow via email. Step 2: verify the token and inject a temp token to reset password
   */
  const verifyRecoveryEmail = async (unsanitizedUsername: string, code: string) => {
    const cfg = getConfig();
    const username = sanitizeEmail(unsanitizedUsername);
    const user = await userDAL.findOne({ username });

    // Use a dummy userId when there's no valid user.
    const shouldReject = !user || (user && !user.isAccepted);

    try {
      await tokenService.validateTokenForUser({
        type: TokenType.TOKEN_EMAIL_PASSWORD_RESET,
        userId: shouldReject ? DUMMY_USER_ID : user.id,
        code
      });
    } catch {
      // If we were going to reject anyway, throw the generic message.
      // If the user was valid but the token failed, same generic message.
      throw new Error("Invalid or expired verification request");
    }

    // Reject *after* the constant-time token validation work.
    if (shouldReject) {
      throw new Error("Invalid or expired verification request");
    }

    const token = crypto.jwt().sign(
      {
        authTokenType: AuthTokenType.ACCOUNT_RECOVERY_TOKEN,
        userId: user.id,
        jti: crypto.randomBytes(16).toString("hex")
      },
      cfg.AUTH_SECRET,
      { expiresIn: cfg.JWT_SIGNUP_LIFETIME }
    );

    return { token, user, userEncryptionVersion: 2 };
  };

  const enableEmailAuthForUser = async (token: string) => {
    const validatedToken = validatePasswordResetAuthorization(token);
    const user = await userDAL.findById(validatedToken.userId);
    if (!user) {
      throw new BadRequestError({ message: "Failed to find user" });
    }

    if (!user.authMethods?.includes(AuthMethod.EMAIL)) {
      const updatedAuthMethods = user.authMethods ? [...user.authMethods, AuthMethod.EMAIL] : [AuthMethod.EMAIL];
      await userDAL.updateById(user.id, {
        authMethods: updatedAuthMethods
      });
    }
  };

  /*
   * Account recovery without email. An instance administrator issues the same one-use token the
   * recovery email would carry and hands the link to the person; it opens the same reset page.
   * Issuing a new link replaces any earlier link or email for that person.
   */
  const createResetLinkForUser = async ({ userId, issuedByUserId }: { userId: string; issuedByUserId: string }) => {
    const cfg = getConfig();
    if (!cfg.SITE_URL) {
      throw new BadRequestError({
        message: "This instance has no SITE_URL, so a reset link would have no address. Set SITE_URL and restart."
      });
    }
    const user = await userDAL.findById(userId);
    if (!user || user.isGhost) throw new NotFoundError({ message: `User '${userId}' was not found.` });
    if (!user.isAccepted) {
      throw new BadRequestError({
        message: `'${user.username}' has not finished signing up, so there is no password to reset. Send them a new invitation instead.`
      });
    }
    const token = await tokenService.createTokenForUser({
      type: TokenType.TOKEN_EMAIL_PASSWORD_RESET,
      userId: user.id
    });
    logger.info(
      `Instance administrator issued a password reset link [userId=${user.id}] [issuedByUserId=${issuedByUserId}]`
    );
    const url = new URL("/account-recovery-reset", cfg.SITE_URL);
    url.searchParams.set("token", token);
    url.searchParams.set("to", user.username);
    return {
      url: url.toString(),
      username: user.username,
      expiresAt: new Date(Date.now() + PASSWORD_RESET_LINK_LIFETIME_MS).toISOString()
    };
  };

  return {
    sendRecoveryEmail,
    verifyRecoveryEmail,
    enableEmailAuthForUser,
    createResetLinkForUser
  };
};
