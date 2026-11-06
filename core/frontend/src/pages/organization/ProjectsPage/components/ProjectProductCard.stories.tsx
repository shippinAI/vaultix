import type { Meta, StoryObj } from "@storybook/react-vite";
import { KeyRoundIcon } from "lucide-react";

import { ProjectProductCard } from "./ProjectProductCard";

const meta = {
  title: "Pages/Organization/ProjectProductCard",
  component: ProjectProductCard,
  parameters: {
    layout: "centered"
  },
  tags: ["autodocs"],
  args: {
    cardId: "project-secret-manager",
    title: "Secrets Management",
    description: "Store, organize and deliver secrets for your applications.",
    icon: KeyRoundIcon,
    iconClassName: "h-4.5 w-4.5 text-product-sm",
    iconContainerClassName: "border-product-sm/30 bg-product-sm/10",
    titleUnderlineClassName: "decoration-product-sm/60",
    stats: [
      { label: "projects", value: "12" },
      { label: "environments", value: "36" },
      { label: "secrets", value: "840" }
    ],
    actionId: "vaultix.projects.open.secret-manager",
    actionLabel: "Open Secrets Management",
    actionHint: "Use your current membership and permissions to continue.",
    secondaryActionLabel: "Show me how",
    secondaryActionId: "vaultix.projects.learn.secret-manager",
    isActionDisabled: false,
    onAction: () => {},
    onSecondaryAction: () => {}
  }
} satisfies Meta<typeof ProjectProductCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  name: "State: Default"
};

export const Disabled: Story = {
  name: "State: Access Blocked",
  args: {
    isActionDisabled: true,
    disabledReason: "You do not have access. Ask an organization admin for access.",
    actionHint: undefined
  }
};

export const NoStats: Story = {
  name: "State: No Stats",
  args: {
    stats: [],
    actionLabel: "Set up Certificate Manager",
    actionHint: "Certificate Manager is not configured for this organization yet."
  }
};
