import { createFileRoute } from "@tanstack/react-router";

import { VaultixLanding } from "./public-site/VaultixLanding";

export const Route = createFileRoute("/")({
  component: VaultixLanding
});
