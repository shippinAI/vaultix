const areas = ["references", "connections", "organization", "owner", "admin", "general"] as const;
const textLimits = { project: 128, environment: 128, path: 1024, connection: 128, search: 256, action: 128 };
const maxInteractions = 1_000_000;

export type VaultixLearningContext = Partial<Record<keyof typeof textLimits, string>> & {
  area?: (typeof areas)[number];
  interactions?: number;
};

export const learningContextSchema = {
  type: "object",
  properties: {
    area: { type: "string", enum: [...areas] },
    ...Object.fromEntries(Object.entries(textLimits).map(([key, maxLength]) => [key, { type: "string", maxLength }])),
    interactions: { type: "integer", minimum: 0, maximum: maxInteractions }
  },
  additionalProperties: false
};

// Context is caller-supplied teaching metadata, never authority or persisted learning history.
// Validate before HTTP schema coercion/removal so HTTP and MCP reject the same inputs.
export const parseLearningContext = (input: unknown): VaultixLearningContext | undefined => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  for (const [key, value] of Object.entries(input)) {
    if (key === "area") {
      if (typeof value !== "string" || !areas.some((area) => area === value)) return undefined;
    } else if (key === "interactions") {
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maxInteractions)
        return undefined;
    } else {
      if (!Object.hasOwn(textLimits, key)) return undefined;
      if (typeof value !== "string" || [...value].length > textLimits[key as keyof typeof textLimits]) return undefined;
    }
  }
  return input as VaultixLearningContext;
};
