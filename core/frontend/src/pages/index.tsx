import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    // The existing auth middleware resolves setup, sign-in, organization selection,
    // and an authenticated user's project dashboard. Help must not replace the app.
    throw redirect({ to: "/login", replace: true });
  }
});
