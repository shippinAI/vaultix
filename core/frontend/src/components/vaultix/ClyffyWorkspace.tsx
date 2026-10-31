import { Button } from "@app/components/v3";
import { useVaultixGuide } from "@app/hooks/api/vaultix/queries";
import { VaultixReferences } from "@app/pages/VaultixReferences";

export default function ClyffyWorkspace({ organizationId }: { organizationId: string }) {
  const guide = useVaultixGuide();
  const action = guide.data?.actions.find((entry) => entry.id === "vaultix.secrets.references");
  if (guide.isPending) return <p role="status">Loading available actions…</p>;
  if (guide.isError || !action)
    return (
      <div role="alert" className="space-y-3">
        <p>The Vaultix action catalog is unavailable. Your vault has not changed.</p>
        <Button
          onClick={() => {
            guide.refetch().catch(() => {});
          }}
        >
          Retry Tools
        </Button>
      </div>
    );
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Choose a project, environment, and folder, then request references. Use Guide Me or the help
        beside each field for a walkthrough.
      </p>
      <VaultixReferences action={action} scopeKey={organizationId} />
      <p className="text-xs text-muted">
        This workspace runs authorized MCP reference tools. Connecting an AI client is separate; an
        AI conversation is not running in this panel.
      </p>
    </div>
  );
}
