import { useState } from "react";
import { CheckIcon, CopyIcon, TerminalIcon } from "lucide-react";

import { Button, Card, CardContent, CardHeader, CardTitle } from "@app/components/v3";
import { GuidedHelp } from "@app/components/vaultix/GuidedHelp";
import { LearningSignals } from "@app/components/vaultix/LearningSignals";
import { useVaultixConnections } from "@app/hooks/api/vaultix/connections";
import { useVaultixGuide } from "@app/hooks/api/vaultix/queries";

export const VaultixConnections = () => {
  const guide = useVaultixConnections();
  const catalog = useVaultixGuide();
  const [selected, setSelected] = useState("codex-subscription");
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const copyMessages = {
    idle: "Your model credentials stay in your client.",
    copied: "Connection copied.",
    failed: "Clipboard unavailable. Select and copy the connection above."
  };
  const option = guide.data?.options.find((entry) => entry.id === selected);
  const url = `${window.location.origin}${guide.data?.mcpPath ?? "/api/v1/vaultix/mcp"}`;
  const connection = selected === "mcp-client" ? url : `[mcp_servers.vaultix]\nurl = "${url}"`;
  return (
    <Card id="clyffy-setup">
      <CardHeader>
        <CardTitle>
          <h2>Clyffy, Your Secrets Guide</h2>
          <GuidedHelp guideId="connections" />
        </CardTitle>
        <p className="text-sm text-muted">
          Bring your AI setup. Vaultix supplies the secret references and permissions.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {catalog.data && (
          <LearningSignals
            area="connections"
            didYouKnow={catalog.data.didYouKnow}
            knowledgeDrops={catalog.data.knowledgeDrops}
            enterpriseCapabilities={catalog.data.enterpriseCapabilities}
          />
        )}
        {guide.isPending && <p role="status">Loading connection options...</p>}
        {guide.isError && (
          <div role="alert">
            <p>We couldn&apos;t load connection options.</p>
            <Button
              onClick={() => {
                guide.refetch().catch(() => {});
              }}
            >
              Retry Connection Guide
            </Button>
          </div>
        )}
        {guide.data && option && (
          <>
            <fieldset className="grid gap-3 md:grid-cols-3">
              <legend className="mb-3 text-sm font-medium">How do you use AI?</legend>
              {guide.data.options.map((entry) => (
                <label
                  key={entry.id}
                  htmlFor={`connection-${entry.id}`}
                  className={`cursor-pointer rounded-md border p-4 ${selected === entry.id ? "border-project bg-project/5" : "border-border"}`}
                >
                  <span className="flex items-center gap-2 font-medium">
                    <input
                      id={`connection-${entry.id}`}
                      aria-label={entry.title}
                      aria-describedby={`connection-${entry.id}-description`}
                      type="radio"
                      name="ai-connection"
                      checked={selected === entry.id}
                      onChange={() => {
                        setSelected(entry.id);
                        setCopied("idle");
                      }}
                      className="accent-project"
                    />
                    {entry.title}
                  </span>
                  <span
                    id={`connection-${entry.id}-description`}
                    className="mt-2 block text-sm text-muted"
                  >
                    {entry.description}
                  </span>
                </label>
              ))}
            </fieldset>
            <ol className="flex flex-col gap-3">
              {option.steps.map((step, index) => (
                <li key={step} className="flex gap-3 text-sm">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded border border-border text-project">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            <div className="overflow-hidden rounded-md border border-border bg-background">
              <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted">
                <TerminalIcon className="size-4" />
                {selected === "mcp-client"
                  ? "Streamable HTTP MCP"
                  : "Add to your Codex config.toml"}
              </div>
              <div
                id="connection-configuration"
                role="region"
                // Keyboard users must be able to scroll long connection text horizontally.
                // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
                tabIndex={0}
                aria-label="MCP connection configuration"
                className="overflow-x-auto p-4 text-sm focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-project"
              >
                <pre>
                  <code>{connection}</code>
                </pre>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(connection);
                    setCopied("copied");
                  } catch {
                    setCopied("failed");
                  }
                }}
              >
                {copied === "copied" ? <CheckIcon /> : <CopyIcon />}
                {copied === "copied" ? "Copied" : "Copy Connection"}
              </Button>
              <span role="status" className="text-sm text-muted">
                {copyMessages[copied]}
              </span>
            </div>
            <p
              id="connection-access"
              tabIndex={-1}
              className="border-t border-border pt-4 text-sm text-muted focus-visible:outline-2 focus-visible:outline-project"
            >
              {guide.data.access}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
};
