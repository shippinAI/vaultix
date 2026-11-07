import type { Meta, StoryObj } from "@storybook/react-vite";
import { KeyRoundIcon } from "lucide-react";
import { expect, fn, userEvent, within } from "storybook/test";

import { ProjectType } from "@app/hooks/api/projects/types";

import { PRODUCT_GUIDANCE } from "./product-guidance";
import { ProjectProductCard } from "./ProjectProductCard";

const meta = {
  title: "Pages/Organization/ProjectProductCard",
  component: ProjectProductCard,
  parameters: {
    layout: "centered",
    a11y: { test: "error" }
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
    secondaryActionId: "vaultix.projects.learn.secret-manager",
    guideSteps: PRODUCT_GUIDANCE[ProjectType.SecretManager],
    isActionDisabled: false,
    onAction: fn()
  }
} satisfies Meta<typeof ProjectProductCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  name: "State: Default",
  play: async ({ canvasElement, args }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Open Secrets Management" })
    );
    await expect(args.onAction).toHaveBeenCalledTimes(1);
  }
};

export const Disabled: Story = {
  name: "State: Access Blocked",
  args: {
    isActionDisabled: true,
    disabledReason: "You do not have access. Ask an organization admin for access.",
    actionHint: undefined
  },
  play: async ({ canvasElement, args }) => {
    const action = within(canvasElement).getByRole("button", { name: "Open Secrets Management" });
    await expect(action).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(action);
    action.focus();
    await userEvent.keyboard("{Enter}");
    await expect(args.onAction).not.toHaveBeenCalled();
  }
};

export const ContextualHelp: Story = {
  name: "Interaction: Learn Without Leaving",
  play: async ({ canvasElement, args }) => {
    const trigger = within(canvasElement).getByRole("button", {
      name: "Show Me How: Secrets Management"
    });
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    const page = within(canvasElement.ownerDocument.body);
    const dialog = await page.findByRole("dialog", { name: "Secrets Management: Getting Started" });
    await expect(within(dialog).getByRole("list", { name: "Workflow steps" })).toBeVisible();
    await expect(args.onAction).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    await expect(trigger).toHaveFocus();
  }
};

export const NarrowLayout: Story = {
  name: "Layout: Narrow Workspace",
  args: {
    title: "Privileged Access Manager",
    description: "Manage privileged accounts, access policies and approved sessions.",
    actionLabel: "Open Privileged Access Manager",
    guideSteps: PRODUCT_GUIDANCE[ProjectType.PAM]
  },
  decorators: [
    (Story) => (
      <div style={{ width: 288, maxWidth: "100%" }}>
        <Story />
      </div>
    )
  ]
};

export const NoStats: Story = {
  name: "State: No Stats",
  args: {
    stats: [],
    actionHint: "No project metrics are available yet. Your current permissions still apply."
  }
};
