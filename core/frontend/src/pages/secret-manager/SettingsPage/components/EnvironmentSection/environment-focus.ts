// Dialog teardown may run after the user has already opened the next menu/dialog.
// Preserve that interaction instead of moving focus outside it and dismissing it.
export const restoreEnvironmentTriggerFocus = (event: Event, target: HTMLElement | null) => {
  event.preventDefault();
  if (
    !target?.isConnected ||
    document.querySelector(
      '[data-state="open"][role="menu"], [data-state="open"][role="dialog"], [data-state="open"][role="alertdialog"]'
    )
  )
    return;
  const active = document.activeElement;
  if (
    active &&
    active !== document.body &&
    active !== document.documentElement &&
    active !== target
  )
    return;
  target.focus();
};
