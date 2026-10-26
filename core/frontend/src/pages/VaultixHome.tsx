import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  BotIcon,
  CheckIcon,
  CopyIcon,
  KeyRoundIcon,
  ShieldCheckIcon
} from "lucide-react";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@app/components/v3";
import { useVaultixGuide } from "@app/hooks/api/vaultix/queries";

import { VaultixReferences } from "./VaultixReferences";

export const VaultixHome = ({ initialized }: { initialized: boolean }) => {
  const guide = useVaultixGuide();
  const [showClyffy, setShowClyffy] = useState(false);
  const [showReferences, setShowReferences] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const mcpConfig = `[mcp_servers.vaultix]\nurl = "${window.location.origin}/api/v1/vaultix/mcp"`;
  const copyConfig = async () => {
    try {
      await navigator.clipboard.writeText(mcpConfig);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a className="sr-only focus:not-sr-only" href="#vaultix-main">
        Skip to Content
      </a>
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-5">
          <Link
            to="/"
            className="flex items-center gap-3 text-xl font-semibold"
            aria-label="Vaultix home"
          >
            <KeyRoundIcon className="size-6 text-project" aria-hidden="true" /> Vaultix
          </Link>
          <Button asChild variant="outline">
            <Link to={initialized ? "/login" : "/admin/signup"}>
              {initialized ? "Open Your Vault" : "Set Up Your Vault"}
              <ArrowRightIcon />
            </Link>
          </Button>
        </div>
      </header>
      <main id="vaultix-main" className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-12">
        <section
          className="grid items-start gap-8 md:grid-cols-[1.3fr_1fr]"
          aria-labelledby="vaultix-title"
        >
          <div className="flex flex-col items-start gap-5">
            <Badge variant="info">
              <ShieldCheckIcon /> Secrets You Own
            </Badge>
            <h1 id="vaultix-title" className="text-4xl leading-tight font-semibold md:text-5xl">
              Build your app.
              <br />
              Keep your keys yours.
            </h1>
            <p className="max-w-xl text-lg text-muted">
              One place for your app&apos;s secrets, from your first API key to production. Give
              your AI assistant the names. Give your app the access.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild variant="project" size="lg">
                <Link to={initialized ? "/login" : "/admin/signup"}>
                  {initialized ? "Open Vaultix" : "Create Your Vault"}
                  <ArrowRightIcon />
                </Link>
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={() => setShowClyffy((shown) => !shown)}
                aria-expanded={showClyffy}
                aria-controls="clyffy-setup"
              >
                <BotIcon /> Connect Clyffy
              </Button>
            </div>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Your First App, Connected</CardTitle>
              <CardDescription>
                A short path from a new project to secrets your app can use.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {guide.isPending && (
                <p role="status" className="text-muted">
                  Loading your setup guide…
                </p>
              )}
              {guide.isError && (
                <div className="flex flex-col gap-3" role="alert">
                  <p>We couldn&apos;t load the setup guide. Check your connection to Vaultix.</p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      guide.refetch().catch(() => {});
                    }}
                  >
                    Try Again
                  </Button>
                </div>
              )}
              {guide.data && (
                <ol className="flex flex-col gap-5">
                  {guide.data.steps.map((step, index) => (
                    <li key={step.id} className="flex gap-3">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border text-sm text-muted">
                        {index + 1}
                      </span>
                      <div className="flex flex-col gap-1">
                        <h2 className="font-medium">{step.title}</h2>
                        <p className="text-sm text-muted">{step.description}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </section>
        {showClyffy && (
          <section id="clyffy-setup" aria-labelledby="clyffy-title">
            <Card>
              <CardHeader>
                <CardTitle id="clyffy-title">Clyffy, Your Secrets Guide</CardTitle>
                <CardDescription>
                  Use your local Codex client and your own ChatGPT sign-in. Your plan&apos;s usage
                  limits apply.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <ol className="list-inside list-decimal space-y-2 text-sm">
                  <li>
                    Sign in through Codex using <code>codex login</code>.
                  </li>
                  <li>
                    Add this connection to your Codex <code>config.toml</code>, then reconnect the
                    client.
                  </li>
                  <li>
                    Ask Codex: &ldquo;Read the Vaultix specialist instructions and help me connect
                    my app.&rdquo;
                  </li>
                </ol>
                <pre className="overflow-x-auto rounded-md border border-border bg-container p-4 text-sm">
                  <code>{mcpConfig}</code>
                </pre>
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="outline"
                    onClick={() => {
                      copyConfig().catch(() => setCopyState("failed"));
                    }}
                  >
                    {copyState === "copied" ? <CheckIcon /> : <CopyIcon />}
                    {copyState === "copied" ? "Copied" : "Copy Connection"}
                  </Button>
                  <p role="status" className="text-sm text-muted">
                    {copyState === "failed"
                      ? "Copy failed. Select and copy the connection text above."
                      : "This connection contains no credentials."}
                  </p>
                </div>
                <p className="text-sm text-muted">
                  Clyffy can explain setup. Authenticated reference tools can list names you may
                  access. Client sign-in integration and secret-changing tools are still being
                  built. Enter secret values only in your vault, never in the conversation.
                </p>
              </CardContent>
            </Card>
          </section>
        )}
        {guide.data && (
          <section aria-label="Your Secret References">
            <Button
              variant="outline"
              onClick={() => setShowReferences((shown) => !shown)}
              aria-expanded={showReferences}
              aria-controls="vaultix-references"
            >
              {guide.data.actions.find((action) => action.id === "vaultix.projects.list")?.label}
            </Button>
            {showReferences &&
              guide.data.actions
                .filter((action) => action.id === "vaultix.secrets.references")
                .map((action) => (
                  <div key={action.id} id="vaultix-references" className="mt-4">
                    <VaultixReferences action={action} />
                  </div>
                ))}
          </section>
        )}
        {guide.data && (
          <section className="grid gap-4 sm:grid-cols-2" aria-label="How Vaultix Works">
            {guide.data.entries.map((entry) => (
              <Card key={entry.id}>
                <CardHeader>
                  <CardTitle>{entry.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted">{entry.description}</p>
                </CardContent>
              </Card>
            ))}
          </section>
        )}
      </main>
      <footer className="mx-auto flex max-w-6xl flex-wrap justify-between gap-3 border-t border-border px-6 py-6 text-sm text-muted">
        <span>Vaultix · AngryVibes LLC</span>
        <span>A SHIPPIN.AI SERVICE</span>
      </footer>
    </div>
  );
};
