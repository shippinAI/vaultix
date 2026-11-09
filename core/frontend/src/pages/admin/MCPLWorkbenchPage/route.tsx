import { createFileRoute, linkOptions } from "@tanstack/react-router";

import { MCPLWorkbenchPage } from "./MCPLWorkbenchPage";

export const Route = createFileRoute(
  "/_authenticate/_inject-org-details/admin/_admin-layout/mcpl"
)({
  component: MCPLWorkbenchPage,
  beforeLoad: () => {
    return {
      breadcrumbs: [
        {
          label: "Admin",
          link: linkOptions({ to: "/admin" })
        },
        {
          label: "MCPL Workbench",
          link: linkOptions({
            to: "/admin/mcpl"
          })
        }
      ]
    };
  }
});
