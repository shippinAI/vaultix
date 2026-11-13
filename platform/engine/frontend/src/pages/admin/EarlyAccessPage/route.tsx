import { createFileRoute, linkOptions } from "@tanstack/react-router";

import { EarlyAccessPage } from "./EarlyAccessPage";

export const Route = createFileRoute(
  "/_authenticate/_inject-org-details/admin/_admin-layout/early-access"
)({
  component: EarlyAccessPage,
  beforeLoad: async () => {
    return {
      breadcrumbs: [
        {
          label: "Admin",
          link: linkOptions({ to: "/admin" })
        },
        {
          label: "Early Access",
          link: linkOptions({ to: "/admin/early-access" })
        }
      ]
    };
  }
});
