import type { Meta, StoryObj } from "@storybook/react-vite";

import { VaultixAmbientBackground } from "./VaultixAmbientBackground";

const meta = {
  title: "Vaultix/Ambient Background",
  component: VaultixAmbientBackground,
  parameters: {
    layout: "fullscreen"
  }
} satisfies Meta<typeof VaultixAmbientBackground>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="relative h-[520px] w-full overflow-hidden bg-[#0d0b09]">
      <VaultixAmbientBackground className="absolute inset-0 h-full w-full" mode="identity" />
      <div className="relative z-10 flex h-full items-center justify-center">
        <div className="rounded-md border border-border bg-black/25 px-6 py-4 backdrop-blur-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#f6b56a]">Vaultix</p>
          <h3 className="mt-2 text-3xl font-semibold text-white">Identity sync</h3>
        </div>
      </div>
    </div>
  )
};
