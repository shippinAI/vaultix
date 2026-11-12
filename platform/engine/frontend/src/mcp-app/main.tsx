import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";

import { Button } from "@app/components/v3/generic/Button/Button";
import { GuidanceHintView, GuidedHelpView } from "@app/components/vaultix/GuidedHelpView";
import { LearningSignals } from "@app/components/vaultix/LearningSignals";
import { ReferenceWorkspace } from "@app/components/vaultix/ReferenceWorkspace";
import { readVaultixGuide } from "@app/hooks/api/vaultix/catalog-contract";
import { readGuidance } from "@app/hooks/api/vaultix/guidance-contract";
import type { ReferenceScope } from "@app/hooks/api/vaultix/reference-contract";
import { createReferenceActions } from "@app/hooks/api/vaultix/reference-contract";

import { VaultixAppBridge } from "./bridge";

import "./app.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false }
  }
});

function Workspace({
  bridge,
  initialSelection
}: {
  bridge: VaultixAppBridge;
  initialSelection?: ReferenceScope;
}) {
  const client = useMemo(
    () => createReferenceActions((name, args) => bridge.call(name, args)),
    [bridge]
  );
  const guidance = useQuery({
    queryKey: ["mcp", "guidance"],
    queryFn: async () => readGuidance(await bridge.call("vaultix.guidance.get", {}))
  });
  const catalog = useQuery({
    queryKey: ["mcp", "catalog"],
    queryFn: async () => {
      const [data, configure] = await Promise.all([
        bridge.call("vaultix.catalog.get", {}),
        bridge.call("vaultix.configure.show", {})
      ]);
      return readVaultixGuide(data, configure);
    }
  });
  if (catalog.isPending) return <p role="status">Loading available actions…</p>;
  if (catalog.isError)
    return (
      <div role="alert">
        <p>The Vaultix action catalog is unavailable.</p>
        <Button
          onClick={() => {
            catalog.refetch().catch(() => {});
          }}
        >
          Retry Tools
        </Button>
      </div>
    );
  return (
    <ReferenceWorkspace
      embedded
      client={client}
      scopeKey="mcp-view"
      initialSelection={initialSelection}
      action={catalog.data.actions.find((action) => action.id === "vaultix.secrets.references")!}
      connectionHelp="Reconnect Vaultix in your AI client and select the intended organization, then retry."
      learning={
        <LearningSignals
          area="references"
          didYouKnow={catalog.data.didYouKnow}
          knowledgeDrops={catalog.data.knowledgeDrops}
        />
      }
      help={{
        overview: <GuidedHelpView query={guidance} guideId="references" />,
        project: <GuidanceHintView query={guidance} guideId="references" target="reference-app" />,
        environment: (
          <GuidanceHintView query={guidance} guideId="references" target="reference-environment" />
        ),
        folder: <GuidanceHintView query={guidance} guideId="references" target="reference-path" />
      }}
    />
  );
}

function App() {
  const [attempt, setAttempt] = useState(0);
  const [bridge, setBridge] = useState<VaultixAppBridge>();
  const [initialSelection, setInitialSelection] = useState<ReferenceScope>();
  const [receivedInput, setReceivedInput] = useState(false);
  const [status, setStatus] = useState<"connecting" | "ready" | "closed">("connecting");
  useEffect(() => {
    let active = true;
    const connection = new VaultixAppBridge({
      onToolInput: (scope) => {
        if (active) {
          setInitialSelection(scope);
          setReceivedInput(true);
        }
      },
      onDisconnect: () => {
        if (active) {
          queryClient.clear();
          setBridge(undefined);
          setStatus("closed");
        }
      },
      onToolResult: (result) => {
        if (!active) return;
        if (
          result &&
          typeof result === "object" &&
          "isError" in result &&
          result.isError === true
        ) {
          queryClient.clear();
          setStatus("closed");
          connection.close();
        } else queryClient.invalidateQueries().catch(() => {});
      }
    });
    setStatus("connecting");
    setInitialSelection(undefined);
    setReceivedInput(false);
    connection
      .connect()
      .then(() => {
        if (active) {
          setBridge(connection);
          setStatus("ready");
        }
      })
      .catch(() => {
        connection.close();
      });
    let frame = 0;
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => connection.size(document.body.scrollHeight));
    });
    resize.observe(document.body);
    return () => {
      active = false;
      resize.disconnect();
      cancelAnimationFrame(frame);
      connection.close();
      queryClient.clear();
    };
  }, [attempt]);
  return (
    <main className="flex flex-col gap-4">
      <header>
        <p className="text-sm text-project">Vaultix.cloud</p>
        <h1 className="text-xl font-semibold">Clyffy References</h1>
        <p className="text-sm text-muted">
          Browse authorized secret names. Values stay in your vault.
        </p>
      </header>
      {status === "connecting" && <p role="status">Connecting to your AI client…</p>}
      {status === "closed" && (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p>
            The connection is unavailable. Reconnect Vaultix in your AI client, then retry this
            view.
          </p>
          <Button onClick={() => setAttempt((value) => value + 1)}>Retry Connection</Button>
        </div>
      )}
      {status === "ready" && !receivedInput && (
        <p role="status">Waiting for the selected Vaultix tool…</p>
      )}
      {status === "ready" && receivedInput && bridge && (
        <Workspace
          key={`${attempt}:${JSON.stringify(initialSelection)}`}
          bridge={bridge}
          initialSelection={initialSelection}
        />
      )}
      <p className="text-xs text-muted">
        Your permissions apply to every request. Guides explain controls; they do not change your
        vault.
      </p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
);
