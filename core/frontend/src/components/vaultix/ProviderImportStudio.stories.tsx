import type { Meta, StoryObj } from "@storybook/react-vite";

import { type ProviderCardModel, ProviderImportStudio } from "./ProviderImportStudio";

// Fixture states for review only. In the product, cards come from
// GET /api/v3/external-migration/providers and a live read of each provider.
const lifecycle: ProviderCardModel["runtime"]["lifecycle"] = ["review", "approve", "import"];

const connected: ProviderCardModel[] = [
  {
    runtime: {
      provider: "doppler",
      connections: [{ id: "c1", name: "Doppler production" }],
      unavailableReason: null,
      lifecycle,
      referenceSafe: true
    },
    source: { state: "ready", projectCount: 4 }
  },
  {
    runtime: {
      provider: "external-vaultix",
      connections: [
        { id: "c2", name: "Infisical Cloud" },
        { id: "c3", name: "Self-hosted" }
      ],
      unavailableReason: null,
      lifecycle,
      referenceSafe: true
    },
    source: { state: "ready", projectCount: 12 }
  }
];

const meta = {
  title: "Vaultix/Provider Import Studio",
  component: ProviderImportStudio,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
  args: { cards: connected, scope: "storybook", onReview: () => {}, onConnect: () => {} }
} satisfies Meta<typeof ProviderImportStudio>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Connected: Story = {};

export const NotConnected: Story = {
  args: {
    cards: connected.map((card) => ({
      runtime: { ...card.runtime, connections: [] },
      source: { state: "none" }
    }))
  }
};

export const ProviderError: Story = {
  args: {
    cards: [
      connected[0],
      {
        ...connected[1],
        source: { state: "error", message: "Failed to list projects from remote Vaultix: 401" }
      }
    ]
  }
};

export const Loading: Story = {
  args: {
    isLoading: true,
    cards: connected.map((card) => ({ ...card, source: { state: "loading" } }))
  }
};

export const NoDestination: Story = {
  args: { reviewBlockedReason: "Open a project's secrets to choose where the import goes." }
};
