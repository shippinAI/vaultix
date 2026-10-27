import type { VaultixGuide } from "../../hooks/api/vaultix/guidance";

export type GuideEventType =
  | "open"
  | "next"
  | "previous"
  | "dismiss"
  | "focus"
  | "restart"
  | "finish";
export type GuideEvent = { type: GuideEventType; stepId: string };
export type GuideState = {
  open: boolean;
  index: number;
  reviewed: boolean;
  sequence: number;
  history: (GuideEvent & { sequence: number })[];
};
export const initialGuideState: GuideState = {
  open: false,
  index: 0,
  reviewed: false,
  sequence: 0,
  history: []
};
const eventTypes: readonly string[] = [
  "open",
  "next",
  "previous",
  "dismiss",
  "focus",
  "restart",
  "finish"
];

// The event boundary accepts no payloads, selectors, values, or executable commands.
export const reduceGuide = (guide: VaultixGuide, state: GuideState, input: unknown): GuideState => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return state;
  const event = input as Record<string, unknown>;
  if (
    Object.keys(event).length !== 2 ||
    typeof event.type !== "string" ||
    !eventTypes.includes(event.type) ||
    event.stepId !== guide.steps[state.index]?.id ||
    (event.type !== "open" && !state.open)
  )
    return state;
  let { index, open, reviewed } = state;
  switch (event.type) {
    case "open":
      open = true;
      break;
    case "dismiss":
    case "focus":
      open = false;
      break;
    case "next":
      if (index === guide.steps.length - 1) return state;
      index += 1;
      break;
    case "previous":
      if (index === 0) return state;
      index -= 1;
      break;
    case "restart":
      index = 0;
      reviewed = false;
      break;
    case "finish":
      if (index !== guide.steps.length - 1) return state;
      reviewed = true;
      open = false;
      break;
    default:
      return state;
  }
  return {
    index,
    open,
    reviewed,
    sequence: state.sequence + 1,
    history: [
      ...state.history.slice(-7),
      {
        type: event.type as GuideEventType,
        stepId: event.stepId as string,
        sequence: state.sequence + 1
      }
    ]
  };
};
