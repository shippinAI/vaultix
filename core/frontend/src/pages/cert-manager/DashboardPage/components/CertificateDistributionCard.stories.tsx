import type { Meta, StoryObj } from "@storybook/react-vite";

import { CertificateDistributionCard } from "./CertificateDistributionCard";

const meta = {
  title: "Pages/Cert Manager/CertificateDistributionCard",
  component: CertificateDistributionCard,
  parameters: {
    layout: "centered"
  },
  tags: ["autodocs"],
  args: {
    title: "By Enrollment Method",
    description: "Distribution by enrollment type",
    entries: [
      {
        id: "acme",
        label: "ACME",
        count: 38,
        onSelect: () => {}
      },
      {
        id: "manual",
        label: "MANUAL",
        count: 14,
        onSelect: () => {}
      },
      {
        id: "vaultix-ca",
        label: "Vaultix CA",
        count: 8
      }
    ],
    actionBaseId: "vaultix.cert.dashboard.distribution.enrollment-method"
  }
} satisfies Meta<typeof CertificateDistributionCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const InteractiveRows: Story = {
  name: "State: Interactive Rows"
};

export const Empty: Story = {
  name: "State: Empty",
  args: {
    entries: [],
    emptyMessage: "No certificate enrollment data available yet."
  }
};

export const ReadOnlyRows: Story = {
  name: "State: Read-only Rows",
  args: {
    entries: [
      { id: "ed25519", label: "ED25519", count: 21 },
      { id: "rsa", label: "RSA", count: 15 },
      { id: "ecdsa", label: "ECDSA", count: 6 }
    ]
  }
};
