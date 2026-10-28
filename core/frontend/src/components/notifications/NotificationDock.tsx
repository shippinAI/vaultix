import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Toaster } from "@app/components/v3/generic/Toast";

import "./notification-dock.css";

const hosts: HTMLElement[] = [];
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

// Independent of the notification API and error-detail dialogs: shared modal
// primitives can register a host without importing the request-error handler.
export function NotificationDock() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return undefined;
    hosts.push(host);
    const observer = new MutationObserver(notify);
    const dialog = host.closest('[role="dialog"], [role="alertdialog"]');
    if (dialog)
      observer.observe(dialog, {
        attributes: true,
        attributeFilter: ["data-state", "aria-hidden"]
      });
    notify();
    return () => {
      observer.disconnect();
      const index = hosts.indexOf(host);
      if (index !== -1) hosts.splice(index, 1);
      notify();
    };
  }, []);
  return <div ref={ref} data-notification-dock="" />;
}

export function NotificationViewport() {
  const root = useRef<HTMLDivElement>(null);
  const [docked, setDocked] = useState(false);
  // React always portals into the same node. Moving its DOM parent must not
  // remount Sonner: that would discard live notifications and reset timers.
  const [container] = useState(() => document.createElement("div"));
  useLayoutEffect(() => {
    const relocate = () => {
      const host = [...hosts]
        .reverse()
        .find(
          (item) => item.isConnected && !item.closest('[data-state="closed"], [aria-hidden="true"]')
        );
      const parent = host || root.current;
      if (parent && container.parentElement !== parent) parent.append(container);
      setDocked(Boolean(host));
    };
    listeners.add(relocate);
    relocate();
    return () => {
      listeners.delete(relocate);
      container.remove();
    };
  }, [container]);
  return (
    <>
      <div ref={root} data-notification-root="" />
      {createPortal(<Toaster expand={docked} visibleToasts={docked ? Infinity : 3} />, container)}
    </>
  );
}
