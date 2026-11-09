import type { Meta, StoryObj } from "@storybook/react-vite";

import { ProviderImportStudio } from "./ProviderImportStudio";

const meta = {
  title: "Vaultix/Provider Import Studio",
  component: ProviderImportStudio,
  parameters: {
    layout: "fullscreen"
  },
  tags: ["autodocs"]
} satisfies Meta<typeof ProviderImportStudio>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <ProviderImportStudio
      providers={[
        {
          id: "doppler",
          name: "Doppler",
          provider: "doppler",
          status: "connected",
          description: "Secrets and environments from your hosted Doppler workspace.",
          lastSync: "2 minutes ago",
          projectCount: 5,
          environmentCount: 12,
          capabilities: ["Project import", "Env mapping", "Approval gate"]
        },
        {
          id: "infisical",
          name: "Infisical",
          provider: "infisical",
          status: "needs-review",
          description: "Import project metadata and values with scoped review before apply.",
          lastSync: "18 minutes ago",
          projectCount: 3,
          environmentCount: 8,
          capabilities: ["Project import", "Value preview", "Scoped policies"]
        },
        {
          id: "local-ai",
          name: "Local AI Sandbox",
          provider: "local-ai",
          status: "sandbox",
          description: "Use a sandboxed local model to test the safest secret-handling patterns.",
          lastSync: "Ready",
          projectCount: 1,
          environmentCount: 3,
          capabilities: ["Dry run", "Reference-only", "Prompt isolation"]
        }
      ]}
    />
  )
};
