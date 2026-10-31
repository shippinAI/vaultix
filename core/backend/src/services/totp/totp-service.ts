import { authenticator } from "otplib";

import { TableName } from "@app/db/schemas";
import { KeyStorePrefixes, KeyStoreTtls, TKeyStoreFactory } from "@app/keystore/keystore";
import { BadRequestError, ForbiddenRequestError, InternalServerError, NotFoundError } from "@app/lib/errors";

import { MfaMethod } from "../auth/auth-type";
import { TKmsServiceFactory } from "../kms/kms-service";
import { TUserDALFactory } from "../user/user-dal";
import { TTotpConfigDALFactory } from "./totp-config-dal";
import {
  TDeleteUserTotpConfigDTO,
  TGetUserTotpConfigDTO,
  TRegisterUserTotpDTO,
  TVerifyUserTotpConfigDTO,
  TVerifyUserTotpDTO
} from "./totp-types";

type TTotpServiceFactoryDep = {
  userDAL: TUserDALFactory;
  totpConfigDAL: TTotpConfigDALFactory;
  kmsService: TKmsServiceFactory;
  keyStore: Pick<TKeyStoreFactory, "setItemWithExpiryNX">;
};

authenticator.options = { window: 1 };

export type TTotpServiceFactory = ReturnType<typeof totpServiceFactory>;

export const totpServiceFactory = ({ totpConfigDAL, kmsService, userDAL, keyStore }: TTotpServiceFactoryDep) => {
  const getUserTotpConfig = async ({ userId }: TGetUserTotpConfigDTO) => {
    const totpConfig = await totpConfigDAL.findOne({
      userId
    });

    if (!totpConfig) {
      throw new NotFoundError({
        message: "TOTP configuration not found"
      });
    }

    if (!totpConfig.isVerified) {
      throw new BadRequestError({
        message: "TOTP configuration has not been verified"
      });
    }

    return {
      isVerified: totpConfig.isVerified
    };
  };

  const registerUserTotp = async ({ userId }: TRegisterUserTotpDTO) => {
    const totpConfig = await totpConfigDAL.transaction(async (tx) => {
      await tx(TableName.Users).where({ id: userId }).select("id").forUpdate().first();
      const verifiedTotpConfig = await totpConfigDAL.findOne(
        {
          userId,
          isVerified: true
        },
        tx
      );

      if (verifiedTotpConfig) {
        throw new BadRequestError({
          message: "TOTP configuration for user already exists"
        });
      }

      const unverifiedTotpConfig = await totpConfigDAL.findOne({ userId, isVerified: false }, tx);

      if (unverifiedTotpConfig) {
        return unverifiedTotpConfig;
      }

      const encryptWithRoot = kmsService.encryptWithRootKey();

      // create new TOTP configuration
      const secret = authenticator.generateSecret();
      const encryptedSecret = encryptWithRoot(Buffer.from(secret));
      const newTotpConfig = await totpConfigDAL.create({ userId, encryptedSecret }, tx);

      return newTotpConfig;
    });

    const user = await userDAL.findById(userId);
    const decryptWithRoot = kmsService.decryptWithRootKey();

    const secret = decryptWithRoot(totpConfig.encryptedSecret).toString();
    const otpUrl = authenticator.keyuri(user.username, "Vaultix", secret);

    return {
      otpUrl
    };
  };

  const verifyUserTotpConfig = async ({ userId, totp }: TVerifyUserTotpConfigDTO) => {
    const totpConfig = await totpConfigDAL.findOne({
      userId
    });

    if (!totpConfig) {
      throw new NotFoundError({
        message: "TOTP configuration not found"
      });
    }

    if (totpConfig.isVerified) {
      throw new BadRequestError({
        message: "TOTP configuration has already been verified"
      });
    }

    const decryptWithRoot = kmsService.decryptWithRootKey();
    const secret = decryptWithRoot(totpConfig.encryptedSecret).toString();
    const isValid = authenticator.verify({
      token: totp,
      secret
    });

    if (!isValid) {
      throw new BadRequestError({
        message: "Invalid TOTP token"
      });
    }

    await totpConfigDAL.updateById(totpConfig.id, {
      isVerified: true
    });

    return {
      success: true
    };
  };

  const verifyUserTotp = async ({ userId, totp }: TVerifyUserTotpDTO) => {
    const totpConfig = await totpConfigDAL.findOne({
      userId
    });

    if (!totpConfig) {
      throw new NotFoundError({
        message: "TOTP configuration not found"
      });
    }

    if (!totpConfig.isVerified) {
      throw new BadRequestError({
        message: "TOTP configuration has not been verified"
      });
    }

    const decryptWithRoot = kmsService.decryptWithRootKey();
    const secret = decryptWithRoot(totpConfig.encryptedSecret).toString();
    if (!/^[0-9]{6}$/.test(totp)) {
      throw new ForbiddenRequestError({ message: "Invalid TOTP" });
    }
    const currentStep = Math.floor(Date.now() / 30_000);
    const verifier = authenticator.clone();
    let step: number | undefined;
    // Match the highest accepted step, including rare adjacent code collisions.
    // Set instance options explicitly: clone preserves the global window option.
    for (const offset of [1, 0, -1]) {
      verifier.options = { epoch: (currentStep + offset) * 30_000, window: 0 };
      if (verifier.verify({ token: totp, secret })) {
        step = currentStep + offset;
        break;
      }
    }
    if (step === undefined) {
      throw new ForbiddenRequestError({ message: "Invalid TOTP" });
    }
    const claimed = await keyStore.setItemWithExpiryNX(
      KeyStorePrefixes.UsedTotpCode(userId, totp),
      KeyStoreTtls.UsedTotpCodeInSeconds,
      "1"
    );
    if (!claimed) {
      throw new ForbiddenRequestError({ message: "Invalid TOTP" });
    }
    // Cache exclusion remains for older consumers. Durable consumption is shared
    // with native Go; cache loss cannot revive an authentication code. Never
    // delete the cache claim after a later SQL failure: retry with a fresh code.
    await totpConfigDAL
      .transaction(async (tx) => {
        await tx(TableName.Users).where({ id: userId }).select("id").forUpdate().first();
        const current = await tx(TableName.TotpConfig)
          .where({ id: totpConfig.id, userId, isVerified: true })
          .select("encryptedSecret")
          .forShare()
          .first();
        if (!current || !Buffer.from(current.encryptedSecret).equals(totpConfig.encryptedSecret)) {
          throw new ForbiddenRequestError({ message: "Invalid TOTP" });
        }
        const consumed = await tx.raw<{ rows: { lastStep: string }[] }>(
          `INSERT INTO vaultix_totp_replays ("factorId","lastStep") SELECT ?,?::bigint
         WHERE abs(?::bigint-floor(extract(epoch FROM clock_timestamp())/30)::bigint)<=1
         ON CONFLICT ("factorId") DO UPDATE SET "lastStep"=EXCLUDED."lastStep"
         WHERE vaultix_totp_replays."lastStep"<EXCLUDED."lastStep" RETURNING "lastStep"`,
          [totpConfig.id, step, step]
        );
        if (consumed.rows.length !== 1) {
          throw new ForbiddenRequestError({ message: "Invalid TOTP" });
        }
      })
      .catch((error: unknown) => {
        if (error instanceof ForbiddenRequestError) throw error;
        throw new InternalServerError({
          message: "Authenticator verification is temporarily unavailable. Wait for a new code and try again."
        });
      });
  };

  const deleteUserTotpConfig = async ({ userId }: TDeleteUserTotpConfigDTO) => {
    await totpConfigDAL.transaction(async (tx) => {
      // Match native proof/account deletion lock order: user before factor.
      await tx(TableName.Users).where({ id: userId }).select("id").forUpdate().first();
      const totpConfig = await totpConfigDAL.findOne(
        {
          userId
        },
        tx
      );

      if (!totpConfig) {
        throw new NotFoundError({
          message: "TOTP configuration not found"
        });
      }

      await totpConfigDAL.deleteById(totpConfig.id, tx);

      // If the user's preferred method is the TOTP config we just removed, reset it
      // so getRequiredMfaMethod doesn't keep challenging for a method that no longer
      // has a verified config, which would force the user back into enrollment. Fall
      // back to email, which is always available.
      const user = await userDAL.findById(userId, tx);
      if (user?.selectedMfaMethod === MfaMethod.TOTP) {
        await userDAL.updateById(userId, { selectedMfaMethod: MfaMethod.EMAIL }, tx);
      }
    });
  };

  return {
    registerUserTotp,
    verifyUserTotpConfig,
    getUserTotpConfig,
    verifyUserTotp,
    deleteUserTotpConfig
  };
};
