import { createFileRoute } from "@tanstack/react-router";

import { VaultixHome } from "./VaultixHome";

export const Route = createFileRoute("/")({
  component: function VaultixIndex() {
    const { serverConfig } = Route.useRouteContext();
    return <VaultixHome initialized={serverConfig?.initialized ?? true} />;
  }
});
