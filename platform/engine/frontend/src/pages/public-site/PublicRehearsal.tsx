import { useId } from "react";

import { GuidanceHint, GuidedHelp } from "@app/components/vaultix/GuidedHelp";
import { ReferenceTeaching } from "@app/components/vaultix/ReferenceTeaching";
import type { ReferenceActions } from "@app/hooks/api/vaultix/reference-contract";

const sampleClient: ReferenceActions = {
  listProjects: async () => [
    {
      id: "example-orbit",
      name: "Orbit / storefront",
      environments: [
        { id: "example-development", name: "Development", slug: "dev" },
        { id: "example-production", name: "Production", slug: "prod" }
      ]
    }
  ],
  listReferences: async (scope) => {
    if (
      scope.projectId !== "example-orbit" ||
      !["dev", "prod"].includes(scope.environment) ||
      scope.secretPath !== "/"
    )
      throw new Error("Example folder unavailable");
    return {
      references: [
        { id: "example-payments", name: "PAYMENTS_API_KEY", version: 3 },
        { id: "example-database", name: "DATABASE_URL", version: 2 }
      ],
      nextOffset: null,
      narration: "Two example reference names. No secret values were requested."
    };
  }
};

export default function PublicRehearsal() {
  const instance = useId();
  return (
    <ReferenceTeaching
      demo
      action={{ label: "Show References" }}
      scopeKey={`public-rehearsal-${instance}`}
      client={sampleClient}
      connectionHelp="This example stays in your browser. Reload the demonstration to retry."
      help={{
        overview: <GuidedHelp guideId="references" />,
        project: <GuidanceHint guideId="references" target="reference-app" />,
        environment: <GuidanceHint guideId="references" target="reference-environment" />,
        folder: <GuidanceHint guideId="references" target="reference-path" />
      }}
    />
  );
}
