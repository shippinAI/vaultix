import type { StorybookConfig } from "@storybook/react-vite";
import { fileURLToPath } from "node:url";

const config: StorybookConfig = {
  stories: [
    "../src/components/v3/**/*.stories.@(js|jsx|mjs|ts|tsx)",
    "../src/pages/organization/ProjectsPage/components/**/*.stories.@(js|jsx|mjs|ts|tsx)",
    "../src/pages/cert-manager/DashboardPage/components/**/*.stories.@(js|jsx|mjs|ts|tsx)"
  ],
  addons: [
    "@storybook/addon-docs",
    "@storybook/addon-a11y",
    "@storybook/addon-vitest",
    {
      name: "@storybook/addon-mcp",
      // The embedded runner fails on Windows (storybookjs/storybook#35864).
      // Keep CLI interaction tests available without advertising a broken MCP tool.
      options: { toolsets: { test: process.platform !== "win32" } }
    }
  ],
  features: { componentsManifest: true },
  staticDirs: ["../public"],
  core: { disableTelemetry: true },
  framework: {
    name: "@storybook/react-vite",
    options: {
      builder: { viteConfigPath: fileURLToPath(new URL("./vite.config.ts", import.meta.url)) }
    }
  }
};
export default config;
