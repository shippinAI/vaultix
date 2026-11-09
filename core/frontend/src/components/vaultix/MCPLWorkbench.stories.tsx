import type { Meta, StoryObj } from "@storybook/react-vite";

import { MCPLWorkbench } from "./MCPLWorkbench";

const meta = {
  title: "Vaultix/MCPL Workbench",
  component: MCPLWorkbench,
  parameters: {
    layout: "fullscreen"
  },
  tags: ["autodocs"]
} satisfies Meta<typeof MCPLWorkbench>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <MCPLWorkbench />
};

export const ExperimentalMode: Story = {
  render: () => (
    <MCPLWorkbench
      modules={[
        { id: "public", label: "Public rehearsal", enabled: true, description: "Landing flows" },
        { id: "auth", label: "Auth admin", enabled: true, description: "Provider keys" },
        { id: "connect", label: "Connectors", enabled: true, description: "Importers" },
        { id: "secrets", label: "Secrets", enabled: true, description: "Working references" },
        { id: "ai", label: "AI sandbox", enabled: true, description: "Local model experiments" },
        { id: "operate", label: "Operations", enabled: true, description: "Receipts and audits" }
      ]}
    />
  )
};
