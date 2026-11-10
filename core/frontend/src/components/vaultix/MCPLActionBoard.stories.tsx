import type { Meta, StoryObj } from "@storybook/react-vite";

import { MCPLActionBoard } from "./MCPLActionBoard";
import { MCPL_ACTIONS } from "./mcpl-manifest";

const meta = {
  title: "Vaultix/MCPL Action Board",
  component: MCPLActionBoard,
  parameters: {
    layout: "fullscreen"
  },
  tags: ["autodocs"],
  args: {
    actions: MCPL_ACTIONS
  }
} satisfies Meta<typeof MCPLActionBoard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => <MCPLActionBoard {...args} />
};

export const ConnectorsOnly: Story = {
  args: {
    initialDomain: "connect",
    actions: MCPL_ACTIONS.filter((action) => action.domain === "connect")
  }
};

export const AIAndGovernance: Story = {
  args: {
    initialDomain: "ai",
    actions: MCPL_ACTIONS.filter((action) => action.domain === "ai" || action.domain === "governance")
  }
};
