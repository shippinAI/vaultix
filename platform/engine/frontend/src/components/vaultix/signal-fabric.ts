import { useEffect } from "react";
import { useLocation } from "@tanstack/react-router";

import type { TAssistantSignal } from "@app/hooks/api/assistant";

// The signal fabric (docs/0123): every catalog action a person takes becomes a value-free signal
// the assistant can read. Signals are built only from the data-vaultix-action attributes and the
// page path. They never read an input, its value or any text on the page.

const MAX_SIGNALS = 20;
// The same rules the server applies; anything else is dropped here first.
const WORD = /^[a-z0-9][a-z0-9._:-]{0,95}$/;
const PATH = /^\/[A-Za-z0-9/_.~%-]{0,255}$/;

const signals: TAssistantSignal[] = [];

const push = (signal: TAssistantSignal) => {
  const last = signals[signals.length - 1];
  if (
    last &&
    last.kind === signal.kind &&
    last.action === signal.action &&
    last.target === signal.target &&
    last.path === signal.path
  )
    return;
  signals.push(signal);
  if (signals.length > MAX_SIGNALS) signals.splice(0, signals.length - MAX_SIGNALS);
};

const safePath = (path: string) => (PATH.test(path) ? path : undefined);

export const recordAction = (element: Element) => {
  const action = element.getAttribute("data-vaultix-action") ?? "";
  if (!WORD.test(action)) return;
  const scope = element.getAttribute("data-vaultix-action-scope") ?? "";
  const target = element.getAttribute("data-vaultix-action-target") ?? "";
  push({
    kind: "action",
    action,
    scope: WORD.test(scope) ? scope : undefined,
    target: WORD.test(target) ? target : undefined,
    path: safePath(window.location.pathname),
    at: new Date().toISOString()
  });
};

export const recordNavigation = (path: string) => {
  const page = safePath(path);
  if (page) push({ kind: "navigate", path: page, at: new Date().toISOString() });
};

// A copy, so callers cannot change the record.
export const readSignals = (): TAssistantSignal[] => signals.map((signal) => ({ ...signal }));

export const clearSignals = () => {
  signals.splice(0, signals.length);
};

const onClick = (event: MouseEvent) => {
  const element =
    event.target instanceof Element ? event.target.closest("[data-vaultix-action]") : null;
  if (element) recordAction(element);
};

// Mount once inside the signed-in layout.
export const SignalFabric = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);
  useEffect(() => {
    recordNavigation(pathname);
  }, [pathname]);
  return null;
};
