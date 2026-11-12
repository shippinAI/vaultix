import { WorkflowHelpStep } from "@app/components/vaultix/WorkflowHelp";
import { ProjectType } from "@app/hooks/api/projects/types";

export const PRODUCT_GUIDANCE: Record<ProjectType, readonly WorkflowHelpStep[]> = {
  [ProjectType.SecretManager]: [
    {
      title: "Choose a project",
      description:
        "Open an existing project or create one for your application when your role permits it."
    },
    {
      title: "Organize environments",
      description: "Keep development, staging and production in separate environments and folders."
    },
    {
      title: "Connect your workload",
      description:
        "Give your workload a scoped machine identity. Use secret references for AI guidance; keep values out of chat."
    }
  ],
  [ProjectType.CertificateManager]: [
    {
      title: "Choose your certificate project",
      description:
        "Vaultix opens your selected project or asks you to choose when several are available. If none exists, start with setup."
    },
    {
      title: "Establish trust",
      description: "Configure a certificate authority and issuance policy inside that project."
    },
    {
      title: "Manage the lifecycle",
      description:
        "Issue and monitor certificates using your current permissions. Request project access when it is required."
    }
  ],
  [ProjectType.KMS]: [
    {
      title: "Choose a key management project",
      description: "Keep encryption keys scoped to the application or team that owns them."
    },
    {
      title: "Set key access",
      description: "Create or select a key, then review which identities may use it."
    },
    {
      title: "Connect a client",
      description:
        "Use the project's integration instructions and verify encryption and decryption with a scoped identity."
    }
  ],
  [ProjectType.SecretScanning]: [
    {
      title: "Choose a scanning project",
      description:
        "Select the project that owns the repositories or other sources you want to scan."
    },
    {
      title: "Connect a data source",
      description: "Review the connection permissions before enabling a scan."
    },
    {
      title: "Review findings",
      description:
        "Investigate exposed credentials and rotate affected secrets. Keep finding values out of AI conversations."
    }
  ],
  [ProjectType.PAM]: [
    {
      title: "Open your access workspace",
      description:
        "Vaultix may initialize the organization's privileged access project when you open it."
    },
    {
      title: "Review accounts and policies",
      description:
        "Organize accounts and check the approval and access rules that apply to your role."
    },
    {
      title: "Request access",
      description:
        "Use the authorized access flow. An administrator may need to approve your project membership or session."
    }
  ]
};
