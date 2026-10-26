import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@app/components/v3";
import { listVaultixProjects, listVaultixReferences } from "@app/hooks/api/vaultix/actions";
import type { VaultixSourceAction } from "@app/hooks/api/vaultix/queries";

export const VaultixReferences = ({ action }: { action: VaultixSourceAction }) => {
  const [projectId, setProjectId] = useState("");
  const [environment, setEnvironment] = useState("");
  const [path, setPath] = useState("/");
  const [scope, setScope] = useState<{
    projectId: string;
    environment: string;
    secretPath: string;
    offset: number;
  }>();
  const projects = useQuery({
    queryKey: ["vaultix", "projects"],
    queryFn: listVaultixProjects,
    retry: false,
    staleTime: 0,
    gcTime: 0
  });
  const references = useQuery({
    queryKey: ["vaultix", "references", scope],
    queryFn: () => listVaultixReferences(scope!),
    enabled: Boolean(scope),
    retry: false,
    staleTime: 0,
    gcTime: 0
  });
  const project = projects.data?.find((entry) => entry.id === projectId);
  const clear = () => setScope(undefined);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Secret References</h2>
        </CardTitle>
        <p className="text-sm text-muted">
          Choose your app and environment. You and Clyffy use the same actions to see names; values
          stay in the vault.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {projects.isPending && <p role="status">Loading your apps...</p>}
        {projects.isError && (
          <div role="alert" className="flex flex-col items-start gap-3">
            <p>
              We couldn&apos;t load your apps. Sign in and choose an organization, or retry your
              connection.
            </p>
            <Button asChild variant="outline">
              <Link to="/login">Sign In</Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                projects.refetch().catch(() => {});
              }}
            >
              Retry Apps
            </Button>
          </div>
        )}
        {projects.data?.length === 0 && (
          <p>
            You don&apos;t have an app in this organization yet. Open your vault to create one or
            ask your administrator for access.
          </p>
        )}
        {Boolean(projects.data?.length) && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              setScope({ projectId, environment, secretPath: path, offset: 0 });
            }}
          >
            <div className="grid gap-4 md:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="reference-app">App</FieldLabel>
                <Select
                  value={projectId}
                  onValueChange={(value) => {
                    setProjectId(value);
                    setEnvironment("");
                    clear();
                  }}
                >
                  <SelectTrigger id="reference-app">
                    <SelectValue placeholder="Choose an app" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.data?.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {entry.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="reference-environment">Environment</FieldLabel>
                <Select
                  value={environment}
                  disabled={!project}
                  onValueChange={(value) => {
                    setEnvironment(value);
                    clear();
                  }}
                >
                  <SelectTrigger id="reference-environment">
                    <SelectValue placeholder="Choose an environment" />
                  </SelectTrigger>
                  <SelectContent>
                    {project?.environments.map((entry) => (
                      <SelectItem key={entry.id} value={entry.slug}>
                        {entry.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="reference-path">Folder</FieldLabel>
                <Input
                  id="reference-path"
                  value={path}
                  maxLength={1024}
                  required
                  pattern="/.*"
                  onChange={(event) => {
                    setPath(event.target.value);
                    clear();
                  }}
                />
              </Field>
            </div>
            <Button
              className="self-start"
              type="submit"
              variant="project"
              disabled={!projectId || !environment || references.isFetching}
            >
              {action.label}
            </Button>
          </form>
        )}
        {scope && references.isFetching && (
          <p role="status">Checking access and loading references...</p>
        )}
        {scope && references.isError && (
          <p role="alert">
            This folder is unavailable or your access has changed. Check the app, environment, and
            folder, then try again.
          </p>
        )}
        {scope && references.data && !references.isError && (
          <div className="flex flex-col gap-3">
            <p role="status" className="text-sm text-muted">
              {references.data.narration}
            </p>
            <p className="text-sm">
              {project?.name} / {scope.environment} / {scope.secretPath}
            </p>
            {references.data.references.length === 0 ? (
              <p>No accessible references on this page.</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {references.data.references.map((reference) => (
                  <li className="flex flex-wrap justify-between gap-3 p-3" key={reference.id}>
                    <code className="break-all">{reference.name}</code>
                    <span className="text-sm text-muted">Version {reference.version}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-3">
              <Button
                variant="outline"
                disabled={!scope.offset || references.isFetching}
                onClick={() => setScope({ ...scope, offset: Math.max(0, scope.offset - 50) })}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                disabled={references.data.nextOffset === null || references.isFetching}
                onClick={() => {
                  if (references.data.nextOffset !== null)
                    setScope({ ...scope, offset: references.data.nextOffset });
                }}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
