import { useQuery } from "@tanstack/react-query";

import { apiRequest } from "@app/config/request";

export type ConnectionOption = {
  id: "codex-subscription" | "codex-existing" | "mcp-client";
  component: "configure-step";
  title: string;
  description: string;
  steps: string[];
};
type Connections = { mcpPath: string; access: string; options: ConnectionOption[] };
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length < 2048;

export const useVaultixConnections = () =>
  useQuery({
    queryKey: ["vaultix", "connections"],
    queryFn: async (): Promise<Connections> => {
      const { data } = await apiRequest.get<unknown>("/api/v1/vaultix/connections");
      if (
        !record(data) ||
        data.schemaVersion !== "vaultix.connections.v1" ||
        data.source !== "catalog" ||
        data.mcpPath !== "/api/v1/vaultix/mcp" ||
        !text(data.access) ||
        !Array.isArray(data.options) ||
        data.options.length !== 3 ||
        !data.options.every(
          (option) =>
            record(option) &&
            ["codex-subscription", "codex-existing", "mcp-client"].includes(String(option.id)) &&
            option.component === "configure-step" &&
            text(option.title) &&
            text(option.description) &&
            Array.isArray(option.steps) &&
            option.steps.length === 3 &&
            option.steps.every(text)
        ) ||
        new Set(data.options.map((option) => (option as Record<string, unknown>).id)).size !== 3
      )
        throw new Error("This Vaultix connection guide is unsupported.");
      return {
        mcpPath: data.mcpPath,
        access: data.access,
        options: data.options as ConnectionOption[]
      };
    }
  });
