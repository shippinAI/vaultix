import { useState } from "react";

import { createNotification } from "@app/components/notifications";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@app/components/v3";
import {
  TAssistantProvider,
  useDeleteAssistantProvider,
  useGetAssistantProviders,
  useTestAssistantProvider,
  useUpdateAssistantProvider
} from "@app/hooks/api/assistant";

import { kindLabel, ProviderDialog } from "./ProviderDialog";

const TestBadge = ({ provider }: { provider: TAssistantProvider }) => {
  if (!provider.lastTestOutcome) return <Badge variant="neutral">Not tested</Badge>;
  return (
    <Badge
      variant={provider.lastTestOutcome === "passed" ? "success" : "danger"}
      title={provider.lastTestMessage}
    >
      {provider.lastTestOutcome === "passed" ? "Test passed" : "Test failed"}
    </Badge>
  );
};

const ProviderRow = ({
  provider,
  onEdit
}: {
  provider: TAssistantProvider;
  onEdit: () => void;
}) => {
  const testProvider = useTestAssistantProvider();
  const updateProvider = useUpdateAssistantProvider();
  const deleteProvider = useDeleteAssistantProvider();
  const [confirmRemove, setConfirmRemove] = useState(false);

  const test = async () => {
    try {
      const { test: result } = await testProvider.mutateAsync(provider.id);
      createNotification(
        result.outcome === "passed"
          ? {
              type: "success",
              title: `${provider.name} answered`,
              text: `${result.message} (${result.latencyMs} ms)`
            }
          : { type: "error", title: `${provider.name} did not answer`, text: result.message }
      );
    } catch {
      // The shared mutation handler reports why the test could not run.
    }
  };

  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col">
          <span className="font-medium">{provider.name}</span>
          <span className="text-xs text-muted">{kindLabel(provider.kind)}</span>
        </div>
      </TableCell>
      <TableCell className="font-mono text-xs">
        <div>{provider.model}</div>
        {provider.fastModel && <div className="text-muted">fast: {provider.fastModel}</div>}
        {provider.deepModel && <div className="text-muted">deep: {provider.deepModel}</div>}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {provider.active && <Badge variant="info">In use</Badge>}
          <TestBadge provider={provider} />
        </div>
        {provider.lastTestOutcome === "failed" && (
          <p className="mt-1 max-w-sm text-xs text-danger">{provider.lastTestMessage}</p>
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="xs" variant="outline" isPending={testProvider.isPending} onClick={test}>
            Test
          </Button>
          {!provider.active && (
            <Button
              size="xs"
              variant="outline"
              isPending={updateProvider.isPending}
              onClick={() =>
                updateProvider.mutate(
                  { id: provider.id, active: true },
                  {
                    onSuccess: () =>
                      createNotification({
                        type: "success",
                        text: `The assistant now uses ${provider.name}.`
                      })
                  }
                )
              }
            >
              Use this
            </Button>
          )}
          <Button size="xs" variant="ghost" onClick={onEdit}>
            Edit
          </Button>
          {confirmRemove ? (
            <Button
              size="xs"
              variant="danger"
              isPending={deleteProvider.isPending}
              onClick={() =>
                deleteProvider.mutate(provider.id, {
                  onSuccess: () =>
                    createNotification({
                      type: "success",
                      text: `Removed ${provider.name} and its key.`
                    })
                })
              }
              onBlur={() => setConfirmRemove(false)}
            >
              Confirm remove
            </Button>
          ) : (
            <Button size="xs" variant="ghost" onClick={() => setConfirmRemove(true)}>
              Remove
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
};

export const ProvidersSection = () => {
  const { data, isPending } = useGetAssistantProviders();
  const [editing, setEditing] = useState<TAssistantProvider | undefined>();
  const [isOpen, setIsOpen] = useState(false);
  const providers = data?.providers ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Providers</CardTitle>
          <CardDescription>
            The models the assistant runs on. One is in use at a time; a persona can also name its
            own. Keys are encrypted with this instance&apos;s root key.
          </CardDescription>
        </div>
        <Button
          variant="neutral"
          onClick={() => {
            setEditing(undefined);
            setIsOpen(true);
          }}
        >
          Add provider
        </Button>
      </CardHeader>
      <CardContent>
        {!isPending && providers.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No provider yet</EmptyTitle>
              <EmptyDescription>
                Add Claude, OpenAI, or your own server. Until one is in use, the assistant stays
                off.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Models</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.map((provider) => (
                <ProviderRow
                  key={provider.id}
                  provider={provider}
                  onEdit={() => {
                    setEditing(provider);
                    setIsOpen(true);
                  }}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <ProviderDialog provider={editing} isOpen={isOpen} onOpenChange={setIsOpen} />
    </Card>
  );
};
