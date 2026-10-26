import { useState } from "react";
import { CheckIcon, CopyIcon, TerminalIcon } from "lucide-react";

import { Button, Card, CardContent, CardHeader, CardTitle } from "@app/components/v3";
import { useVaultixConnections } from "@app/hooks/api/vaultix/connections";

export const VaultixConnections = () => {
  const guide = useVaultixConnections();
  const [selected, setSelected] = useState("codex-subscription");
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const option = guide.data?.options.find((entry) => entry.id === selected);
  const url = `${window.location.origin}${guide.data?.mcpPath ?? "/api/v1/vaultix/mcp"}`;
  const connection = selected === "mcp-client" ? url : `[mcp_servers.vaultix]\nurl = "${url}"`;
  return (
    <Card id="clyffy-setup">
      <CardHeader>
        <CardTitle>
          <h2>Clyffy, Your Secrets Guide</h2>
        </CardTitle>
        <p className="text-sm text-muted">
          Bring your AI setup. Vaultix supplies the secret references and permissions.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
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
                  <span className="mt-2 block text-sm text-muted">{entry.description}</span>
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
              <pre className="overflow-x-auto p-4 text-sm">
                <code>{connection}</code>
              </pre>
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
                {copied === "failed"
                  ? "Clipboard unavailable. Select and copy the connection above."
                  : "Your model credentials stay in your client."}
              </span>
            </div>
            <p className="border-t border-border pt-4 text-sm text-muted">{guide.data.access}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
};
