import { Button } from "@app/components/v3";
import { useVaultixGuide } from "@app/hooks/api/vaultix/queries";
import { VaultixReferences } from "@app/pages/VaultixReferences";

import { AssistantChat } from "./AssistantChat";

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
    <div className="space-y-6">
      <AssistantChat />
      <div className="space-y-4 border-t border-border pt-4">
        <p className="text-sm text-muted">
          Or browse references yourself: choose a project, environment, and folder, then request
          references. Use Guide Me or the help beside each field for a walkthrough.
        </p>
        <VaultixReferences action={action} scopeKey={organizationId} />
      </div>
      <p className="text-xs text-muted">
        The assistant and these tools run with your permissions and see names and references only.
        Connecting your own AI client is separate.
      </p>
    </div>
  );
}
