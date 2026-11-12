import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  BookOpenIcon,
  BotIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  LockKeyholeIcon
} from "lucide-react";

import { Badge, Button, Card } from "@app/components/v3";
import { useVaultixGuide } from "@app/hooks/api/vaultix/queries";

import {
  VaultixPrinciplesCards,
  VaultixWorkspaceSetupCard
} from "./vaultix-home/VaultixWorkspaceCards";
import { VaultixConnections } from "./VaultixConnections";
import { VaultixReferences } from "./VaultixReferences";

export const VaultixHome = ({ initialized }: { initialized: boolean }) => {
  const guide = useVaultixGuide();
  const [view, setView] = useState<"workspace" | "references" | "clyffy">("workspace");
  const heading = useRef<HTMLHeadingElement>(null);
  const previousView = useRef(view);
  useEffect(() => {
    if (previousView.current !== view) heading.current?.focus();
    previousView.current = view;
  }, [view]);
  const titles = {
    workspace: "Your secrets. Your workspace.",
    references: "Find a reference. Keep the value private.",
    clyffy: "Your AI, connected to Vaultix."
  };
  const referencesAction = guide.data?.actions.find(
    (action) => action.id === "vaultix.secrets.references"
  );
  const projectsAction = guide.data?.actions.find(
    (action) => action.id === "vaultix.projects.list"
  );
  return (
    <div className="h-dvh overflow-y-auto bg-background text-foreground">
      <a className="sr-only focus:not-sr-only" href="#vaultix-main">
        Skip to Content
      </a>
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-5 py-4 md:px-8">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="flex items-center gap-3 text-xl font-semibold tracking-tight"
            aria-label="Vaultix home"
          >
            <img src="/images/vaultix-mark.svg" alt="" aria-hidden="true" className="size-9" />
            Vaultix
          </Link>
          <span className="hidden border-l border-border pl-3 text-xs font-normal tracking-wide text-muted sm:inline">
            SECRETS + AI
          </span>
        </div>
        <Button asChild variant="project">
          <Link to={initialized ? "/login" : "/admin/signup"}>
            {initialized ? "Open Your Vault" : "Set Up Your Vault"}
            <ArrowRightIcon />
          </Link>
        </Button>
      </header>
      <div className="grid min-h-[calc(100vh-5rem)] lg:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-5 border-b border-border p-4 lg:border-r lg:border-b-0 lg:p-5">
          <p className="hidden text-xs font-medium tracking-widest text-muted uppercase lg:block">
            Workspace
          </p>
          <nav aria-label="Vaultix workspace" className="flex flex-wrap gap-2 lg:flex-col">
            <Button
              variant={view === "workspace" ? "project" : "ghost"}
              className="justify-start"
              onClick={() => setView("workspace")}
              aria-pressed={view === "workspace"}
            >
              <LayoutDashboardIcon />
              Overview
            </Button>
            {projectsAction && (
              <Button
                variant={view === "references" ? "project" : "ghost"}
                className="h-auto min-h-9 justify-start text-left whitespace-normal lg:w-full"
                onClick={() => setView("references")}
                aria-pressed={view === "references"}
              >
                <KeyRoundIcon />
                {projectsAction.label}
              </Button>
            )}
            <Button
              variant={view === "clyffy" ? "project" : "ghost"}
              className="justify-start"
              onClick={() => setView("clyffy")}
              aria-pressed={view === "clyffy"}
            >
              <BotIcon />
              Connect Clyffy
            </Button>
            <Button asChild variant="ghost" className="justify-start">
              <a href="/api/docs" target="_blank" rel="noreferrer">
                <BookOpenIcon />
                API Reference
              </a>
            </Button>
          </nav>
          <div className="mt-auto hidden border-t border-border pt-5 text-xs leading-relaxed text-muted lg:block">
            <LockKeyholeIcon className="mb-2 size-4 text-project" />
            Secret values stay in your vault.
            <br />
            AI works with references.
          </div>
        </aside>
        <main
          id="vaultix-main"
          tabIndex={-1}
          className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-7 p-5 md:p-8 lg:p-10"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="mb-2 text-xs tracking-widest text-project uppercase">
                Your development workspace
              </p>
              <h1
                ref={heading}
                tabIndex={-1}
                className="text-3xl font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-project"
              >
                {titles[view]}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
                One place for your app&apos;s secrets and access controls. Build with names and
                references; give the running app the access it needs.
              </p>
            </div>
            <Badge variant="neutral">Software features included</Badge>
          </div>
          {guide.isPending && <p role="status">Loading your workspace...</p>}
          {guide.isError && (
            <Card role="alert">
              <p>We couldn&apos;t load your workspace. Check your connection to Vaultix.</p>
              <Button
                className="self-start"
                onClick={() => {
                  guide.refetch().catch(() => {});
                }}
              >
                Try Again
              </Button>
            </Card>
          )}
          {view === "clyffy" && guide.data && <VaultixConnections />}
          {view === "references" && referencesAction && (
            <VaultixReferences action={referencesAction} />
          )}
          {view === "workspace" && guide.data && (
            <>
              <VaultixWorkspaceSetupCard steps={guide.data.steps} />
              <VaultixPrinciplesCards entries={guide.data.entries} />
            </>
          )}
          <footer className="mt-auto flex flex-wrap justify-between gap-3 border-t border-border pt-5 text-xs text-muted">
            <span>Vaultix · AngryVibes LLC</span>
            <span>Shippin secrets you own · shippin.ai</span>
          </footer>
        </main>
      </div>
    </div>
  );
};
