import { useQuery } from "@tanstack/react-query";

import { apiRequest } from "@app/config/request";

type CatalogEntry = { id: string; title: string; description: string };
type ConfigureStep = CatalogEntry & { component: "configure-step"; href?: string; label?: string };
export type VaultixSourceAction = {
  id: "vaultix.projects.list" | "vaultix.secrets.references";
  component: "action-button";
  label: string;
  narration: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isEntry = (value: unknown): value is CatalogEntry & Record<string, unknown> =>
  isRecord(value) &&
  [value.id, value.title, value.description].every(
    (field) => typeof field === "string" && field.length < 2048
  );

export const useVaultixGuide = () =>
  useQuery({
    queryKey: ["vaultix", "guide"],
    queryFn: async () => {
      const [catalogResponse, configureResponse] = await Promise.all([
        apiRequest.get<unknown>("/api/v1/vaultix/catalog"),
        apiRequest.get<unknown>("/api/v1/vaultix/configure")
      ]);
      const catalog = catalogResponse.data;
      const configure = configureResponse.data;
      if (
        !isRecord(catalog) ||
        catalog.schemaVersion !== "vaultix.catalog.v1" ||
        catalog.source !== "catalog" ||
        !Array.isArray(catalog.entries) ||
        catalog.entries.length > 20 ||
        !catalog.entries.every(isEntry) ||
        !Array.isArray(catalog.actions) ||
        catalog.actions.length !== 2 ||
        !catalog.actions.every(
          (action) =>
            isRecord(action) &&
            ["vaultix.projects.list", "vaultix.secrets.references"].includes(String(action.id)) &&
            action.component === "action-button" &&
            typeof action.label === "string" &&
            action.label.length < 100 &&
            typeof action.narration === "string" &&
            action.narration.length < 500
        ) ||
        new Set(catalog.actions.map((action) => (action as Record<string, unknown>).id)).size !==
          2 ||
        !isRecord(configure) ||
        configure.schemaVersion !== "vaultix.configure.v1" ||
        configure.source !== "catalog" ||
        !Array.isArray(configure.components) ||
        configure.components.length > 20 ||
        !configure.components.every(
          (step) =>
            isEntry(step) &&
            isRecord(step) &&
            step.component === "configure-step" &&
            (step.href === undefined || step.href === "/login") &&
            (step.label === undefined ||
              (typeof step.label === "string" && step.label.length < 100))
        )
      ) {
        throw new Error("This Vaultix guide is not supported. Update the app and server together.");
      }
      return {
        entries: catalog.entries as CatalogEntry[],
        actions: catalog.actions as VaultixSourceAction[],
        steps: configure.components as ConfigureStep[]
      };
    }
  });
