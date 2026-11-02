import { createFileRoute, redirect } from "@tanstack/react-router";

import { SignUpPage } from "./SignUpPage";

export const Route = createFileRoute("/_restrict-login-signup/admin/signup")({
  component: SignUpPage,
  beforeLoad: ({ context }) => {
    if (!context.serverConfig)
      throw new Error("Vaultix configuration is unavailable. Reload to try again.");
    if (context.serverConfig.initialized) {
      throw redirect({
        to: "/login"
      });
    }
  }
});
