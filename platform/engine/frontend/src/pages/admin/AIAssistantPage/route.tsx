import { createFileRoute, linkOptions } from "@tanstack/react-router";

import { AIAssistantPage } from "./AIAssistantPage";

export const Route = createFileRoute(
  "/_authenticate/_inject-org-details/admin/_admin-layout/ai-assistant"
)({
  component: AIAssistantPage,
  beforeLoad: async () => {
    return {
      breadcrumbs: [
        {
          label: "Admin",
          link: linkOptions({ to: "/admin" })
        },
        {
          label: "AI Assistant",
          link: linkOptions({ to: "/admin/ai-assistant" })
        }
      ]
    };
  }
});
