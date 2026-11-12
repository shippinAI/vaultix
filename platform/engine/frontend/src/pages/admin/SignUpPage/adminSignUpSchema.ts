import { z } from "zod";

import { createPasswordSchema } from "@app/components/utilities/checks/password/passwordPolicy";
import { TPasswordPolicy } from "@app/hooks/api/admin/types";

export const createAdminSignUpSchema = (
  passwordPolicy: TPasswordPolicy,
  setupCodeRequired = false
) =>
  z
    .object({
      firstName: z.string().trim().min(1, "First name is required"),
      lastName: z.string().trim().optional(),
      email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
      password: createPasswordSchema(passwordPolicy),
      confirmPassword: z.string().min(1, "Please confirm your password"),
      setupCode: z.string().trim().max(128).optional()
    })
    .refine(({ confirmPassword, password }) => confirmPassword === password, {
      message: "Passwords do not match",
      path: ["confirmPassword"]
    })
    .refine(({ setupCode }) => !setupCodeRequired || Boolean(setupCode), {
      message: "Enter the setup code from the installer",
      path: ["setupCode"]
    });

export type AdminSignUpFormData = z.infer<ReturnType<typeof createAdminSignUpSchema>>;
