import { useState } from "react";
import { ArrowUpCircleIcon, ExternalLinkIcon, RefreshCwIcon } from "lucide-react";

import {
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@app/components/v3";
import {
  updateMessages as messages,
  useCheckVaultixUpdates,
  useVaultixUpdates,
  vaultixReleases as releases
} from "@app/hooks/api/vaultix/updates";

export const VersionBadge = () => {
  const [open, setOpen] = useState(false);
  const status = useVaultixUpdates();
  const check = useCheckVaultixUpdates();
  const { data } = status;
  const available = !status.isError && data?.state === "available";
  const canCheck = data && !["disabled", "managed", "development"].includes(data.state);
  let statusMessage = data ? messages[data.state] : "Loading update status…";
  if (status.isError || check.isError)
    statusMessage =
      "Update status could not be refreshed. Try again. If it keeps failing, ask your administrator to check access and connectivity.";
  if (check.isPending) statusMessage = "Checking the stable release channel…";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip disableHoverableContent={false}>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              variant={available ? "info" : "ghost"}
              size="sm"
              className="mr-2 min-h-11 min-w-11"
              aria-label={available ? "Vaultix Update Available" : "Vaultix Version and Updates"}
            >
              <ArrowUpCircleIcon aria-hidden="true" />
              <span className="hidden sm:inline">{available ? "Update Available" : "Updates"}</span>
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent className="pointer-events-auto max-w-xs motion-reduce:animate-none!">
          {available
            ? "Review the new release and upgrade steps."
            : "View this build and check for Vaultix updates."}
        </TooltipContent>
      </Tooltip>
      <DialogContent
        className="motion-reduce:animate-none!"
        overlayClassName="motion-reduce:animate-none!"
      >
        <DialogHeader>
          <DialogTitle>Vaultix Updates</DialogTitle>
          <DialogDescription className="text-muted">
            Release information for this instance and your CLI.
          </DialogDescription>
        </DialogHeader>
        <DialogBody
          role="region"
          aria-label="Release Information"
          tabIndex={0}
          className="space-y-5 pb-2 focus-visible:outline-2 focus-visible:outline-info"
        >
          <div
            role="status"
            aria-live="polite"
            className="rounded-md border border-border bg-container p-4 text-sm"
          >
            {statusMessage}
          </div>
          {data && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted">Installed</dt>
              <dd className="font-mono break-all">{data.currentVersion}</dd>
              <dt className="text-muted">Latest stable</dt>
              <dd className="font-mono break-all">{data.latestVersion ?? "Not known"}</dd>
              <dt className="text-muted">Last checked</dt>
              <dd>{data.checkedAt ? new Date(data.checkedAt).toLocaleString() : "Not checked"}</dd>
            </dl>
          )}
          <section className="space-y-2 text-sm" aria-labelledby="vaultix-upgrade-heading">
            <h3 id="vaultix-upgrade-heading" className="font-medium">
              Plan an Upgrade
            </h3>
            <p className="text-muted">
              For self-hosted Vaultix, review release notes, back up your database and encryption
              configuration, then verify the new image on your infrastructure before switching. Keep
              your previous image for rollback.
            </p>
            <p className="text-muted">
              Your administrator controls deployment. Checking here does not install or restart
              anything.
            </p>
          </section>
          <section className="space-y-2 text-sm" aria-labelledby="vaultix-cli-update-heading">
            <h3 id="vaultix-cli-update-heading" className="font-medium">
              Check Your CLI
            </h3>
            <p className="text-muted">
              Run these commands on the machine where you use Vaultix. Both executable names are
              supported.
            </p>
            <pre className="overflow-x-auto rounded-md border border-border bg-container p-3 text-xs">
              <code>{"vaultix version\nvaultix update check"}</code>
            </pre>
            <p className="text-muted">
              Older CLI builds may not have these commands. Review the release notes for
              installation instructions.
            </p>
          </section>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Close</Button>
          </DialogClose>
          <Button variant="outline" asChild>
            <a href={data?.releaseUrl ?? releases} target="_blank" rel="noopener noreferrer">
              Release Notes <ExternalLinkIcon aria-hidden="true" />
            </a>
          </Button>
          {(canCheck || status.isError) && (
            <Button
              variant="project"
              disabled={check.isPending || status.isFetching}
              onClick={() => {
                if (status.isError) status.refetch().catch(() => {});
                else check.mutate();
              }}
            >
              <RefreshCwIcon aria-hidden="true" />
              {check.isPending ? "Checking…" : "Check for Updates"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
