import type { Meta, StoryObj } from "@storybook/react-vite";

import { MCPL_ACTIONS, resolveMcplActions } from "./mcpl-manifest";
import { MCPLWorkbench } from "./MCPLWorkbench";
import type { ProviderCardModel } from "./ProviderImportStudio";

// Fixture runtime for review only; the admin page binds the real provider runtime.
const providerCards: ProviderCardModel[] = [
  {
    runtime: {
      provider: "doppler",
      connections: [{ id: "c1", name: "Doppler production" }],
      unavailableReason: null,
      lifecycle: ["review", "approve", "import"],
      referenceSafe: true
    },
    source: { state: "ready", projectCount: 4 }
  },
  {
    runtime: {
      provider: "external-vaultix",
      connections: [],
      unavailableReason: null,
      lifecycle: ["review", "approve", "import"],
      referenceSafe: true
    },
    source: { state: "none" }
  }
];

const meta = {
  title: "Vaultix/MCPL Workbench",
  component: MCPLWorkbench,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
  args: {
    providerCards,
    actions: resolveMcplActions(
      MCPL_ACTIONS,
      providerCards.map((card) => card.runtime)
    ),
    onAction: () => {},
    canRunAction: (action) => action.domain !== "ai",
    onConnect: () => {}
  }
} satisfies Meta<typeof MCPLWorkbench>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const LoadingProviders: Story = {
  args: { isProvidersLoading: true, actions: MCPL_ACTIONS }
};
