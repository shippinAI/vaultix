import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet";
import { useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";

import { AuthPageLayout } from "@app/components/auth/AuthPageLayout";
import { AuthPagePanel } from "@app/components/auth/AuthPagePanel";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@app/components/v3";
import { apiRequest } from "@app/config/request";
import { selectOrganization } from "@app/hooks/api/auth/queries";
import { useGetOrganizations } from "@app/hooks/api/organization/queries";
import {
  projectKeys,
  useGetUserProjectsByType,
  useGetWorkspaceById
} from "@app/hooks/api/projects";
import { ProjectType } from "@app/hooks/api/projects/types";
import { setAuthToken } from "@app/hooks/api/reactQuery";

import {
  createHandoffSession,
  HandoffProblem,
  HandoffRequest,
  HandoffSession,
  HandoffSnapshot,
  isValidSecretName,
  isValidSecretPath,
  kindLabel,
  readRememberedChoice,
  rememberedChoiceKey,
  serializeRememberedChoice,
  sourceName
} from "./save-secret-handoff";

const PROBLEMS: Record<HandoffProblem, string> = {
  "feature-off": "Saving from other applications is not turned on for this Vaultix.",
  parameters: "The request contains parameters Vaultix does not accept.",
  version: "The request uses a version of Save to Vaultix this Vaultix does not support.",
  source: "The request does not say which application sent it.",
  origin: "The application that sent this request is not allowed to save secrets here.",
  nonce: "The request is missing a valid one-time identifier.",
  kind: "The request does not say what kind of secret it is."
};

const readStoredChoice = (userId: string) => {
  try {
    return readRememberedChoice(localStorage.getItem(rememberedChoiceKey(userId)));
  } catch {
    return null;
  }
};

const Shell = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <AuthPageLayout variant="focused" contentClassName="max-w-xl" showFooter={false}>
    <Helmet>
      <title>Save to Vaultix</title>
    </Helmet>
    <AuthPagePanel className="flex flex-col gap-5">
      <h1 className="text-2xl font-medium text-foreground">{title}</h1>
      {children}
    </AuthPagePanel>
  </AuthPageLayout>
);

const RequestError = ({ message }: { message: string }) => (
  <Shell title="This request cannot be used">
    <Alert variant="danger">
      <AlertTitle>Nothing was saved</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
    <p className="text-sm text-muted">
      Close this window and try again from the application you started in.
    </p>
  </Shell>
);

const resultCopy = (result: NonNullable<HandoffSnapshot["result"]>) => {
  if (result.status === "fulfilled") {
    return {
      variant: "success" as const,
      title: "Saved",
      text: `${result.secretName} is stored in Vaultix (version ${result.version}).`
    };
  }
  if (result.status === "approval") {
    return {
      variant: "info" as const,
      title: "Waiting for approval",
      text: `This project needs approval for changes. ${result.secretName} is saved once the request is approved.`
    };
  }
  if (result.status === "error") {
    return { variant: "danger" as const, title: "Not saved", text: "Nothing was stored." };
  }
  return { variant: "default" as const, title: "Cancelled", text: "Nothing was stored." };
};

const HandoffForm = ({
  request,
  organizationId: initialOrganizationId,
  userId
}: {
  request: HandoffRequest;
  organizationId: string;
  userId: string;
}) => {
  const queryClient = useQueryClient();
  const sessionRef = useRef<HandoffSession | null>(null);
  const [snapshot, setSnapshot] = useState<HandoffSnapshot>({ phase: "idle", valueLength: 0 });
  const remembered = useMemo(() => readStoredChoice(userId), [userId]);
  const [organizationId, setOrganizationId] = useState(initialOrganizationId);
  const [organizationError, setOrganizationError] = useState<string>();
  const [switchingOrganization, setSwitchingOrganization] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [environment, setEnvironment] = useState("");
  const [secretPath, setSecretPath] = useState(
    remembered?.organizationId === initialOrganizationId ? remembered.secretPath : "/"
  );
  const [secretName, setSecretName] = useState(request.name);
  const [submitted, setSubmitted] = useState(false);

  const { data: organizations = [] } = useGetOrganizations();
  const { data: projects = [], isPending: projectsLoading } = useGetUserProjectsByType(
    ProjectType.SecretManager
  );
  const project = projects.find((candidate) => candidate.id === projectId);
  // The project list does not carry environments; the project itself does.
  const { data: projectDetails } = useGetWorkspaceById(project ? projectId : "");
  const environments = projectDetails?.id === projectId ? projectDetails.environments : [];

  useEffect(() => {
    // One session per page load: StrictMode remounts must not post ready twice.
    sessionRef.current ??= createHandoffSession({
      opener: window.opener as Window | null,
      request,
      createSecret: async ({ path, body }) => (await apiRequest.post(path, body)).data,
      onChange: setSnapshot
    });
    const session = sessionRef.current;
    const onMessage = (event: MessageEvent) =>
      session.receive({ origin: event.origin, source: event.source, data: event.data });
    const onPageHide = () => session.pageHidden();
    window.addEventListener("message", onMessage);
    window.addEventListener("pagehide", onPageHide);
    session.start();
    setSnapshot(session.snapshot());
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [request]);

  useEffect(() => {
    if (projectsLoading || projects.some((candidate) => candidate.id === projectId)) return;
    const preferred =
      remembered?.organizationId === organizationId
        ? projects.find((candidate) => candidate.id === remembered.projectId)
        : undefined;
    setProjectId((preferred ?? projects[0])?.id ?? "");
    setEnvironment("");
  }, [projects, projectsLoading, projectId, remembered, organizationId]);

  useEffect(() => {
    if (environments.length === 0 || environments.some((env) => env.slug === environment)) return;
    const preferred =
      remembered?.organizationId === organizationId && remembered.projectId === projectId
        ? environments.find((env) => env.slug === remembered.environment)
        : undefined;
    setEnvironment((preferred ?? environments[0]).slug);
  }, [environments, environment, remembered, organizationId, projectId]);

  const changeOrganization = async (nextOrganizationId: string) => {
    if (nextOrganizationId === organizationId) return;
    setOrganizationError(undefined);
    setSwitchingOrganization(true);
    try {
      const selected = await selectOrganization({ organizationId: nextOrganizationId });
      if (selected.isMfaEnabled) {
        setOrganizationError(
          "That organization asks for multi-factor authentication. Switch to it in Vaultix, then start again."
        );
        return;
      }
      setAuthToken(selected.token);
      setOrganizationId(nextOrganizationId);
      setProjectId("");
      await queryClient.invalidateQueries({ queryKey: projectKeys.getAllUserProjects() });
    } catch {
      setOrganizationError("Vaultix could not switch to that organization.");
    } finally {
      setSwitchingOrganization(false);
    }
  };

  const nameValid = isValidSecretName(secretName);
  const pathValid = isValidSecretPath(secretPath);
  const canSave =
    snapshot.phase === "received" &&
    Boolean(project) &&
    environments.some((env) => env.slug === environment) &&
    !switchingOrganization;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    const session = sessionRef.current;
    if (!session || !canSave || !nameValid || !pathValid) return;
    const after = await session.save({ projectId, environment, secretPath, secretName });
    if (after.phase === "done") {
      try {
        localStorage.setItem(
          rememberedChoiceKey(userId),
          serializeRememberedChoice({ organizationId, projectId, environment, secretPath })
        );
      } catch {
        // A remembered choice is a convenience only.
      }
    }
  };

  const partner = sourceName(request.source);
  if (snapshot.phase === "no-opener") {
    return (
      <RequestError
        message={`This window is not connected to ${partner}, so there is nothing to receive. If you just signed in, choose Save to Vaultix in ${partner} again.`}
      />
    );
  }

  if (snapshot.result) {
    const copy = resultCopy(snapshot.result);
    return (
      <Shell title="Save to Vaultix">
        <Alert variant={copy.variant}>
          <AlertTitle>{copy.title}</AlertTitle>
          <AlertDescription>{copy.text}</AlertDescription>
        </Alert>
        <p className="text-sm text-muted">{partner} has been told the outcome.</p>
        <div>
          <Button variant="neutral" onClick={() => window.close()}>
            Close Window
          </Button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title={`Save a ${kindLabel(request.kind)} from ${partner}`}>
      <p className="text-sm text-muted">
        {partner} at <span className="font-mono text-foreground">{request.origin}</span> wants to
        store a secret in Vaultix. It is saved with your own access, so your permissions and the
        project&apos;s approval rules apply.
      </p>
      <Alert variant={snapshot.valueLength > 0 ? "success" : "info"} aria-live="polite">
        <AlertTitle>
          {snapshot.valueLength > 0 ? "Secret received" : `Waiting for ${partner}`}
        </AlertTitle>
        <AlertDescription>
          {snapshot.valueLength > 0
            ? `${snapshot.valueLength} characters, held in this window only until you save or cancel.`
            : "Keep this window open. The secret arrives from the window that opened it."}
        </AlertDescription>
      </Alert>
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        {organizations.length > 1 && (
          <Field>
            <FieldLabel htmlFor="save-secret-organization">Organization</FieldLabel>
            <Select
              value={organizationId}
              onValueChange={changeOrganization}
              disabled={switchingOrganization || snapshot.phase === "saving"}
            >
              <SelectTrigger id="save-secret-organization" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {organizations.map((organization) => (
                  <SelectItem key={organization.id} value={organization.id}>
                    {organization.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError>{organizationError}</FieldError>
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor="save-secret-project">Project</FieldLabel>
          <Select
            value={projectId}
            onValueChange={(next) => {
              setProjectId(next);
              setEnvironment("");
            }}
          >
            <SelectTrigger id="save-secret-project" className="w-full">
              <SelectValue
                placeholder={projectsLoading ? "Loading projects" : "Choose a project"}
              />
            </SelectTrigger>
            <SelectContent>
              {projects.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!projectsLoading && projects.length === 0 && (
            <FieldError>You have no secrets projects in this organization.</FieldError>
          )}
        </Field>
        <Field>
          <FieldLabel htmlFor="save-secret-environment">Environment</FieldLabel>
          <Select
            value={environment}
            onValueChange={setEnvironment}
            disabled={environments.length === 0}
          >
            <SelectTrigger id="save-secret-environment" className="w-full">
              <SelectValue placeholder="Choose an environment" />
            </SelectTrigger>
            <SelectContent>
              {environments.map((env) => (
                <SelectItem key={env.slug} value={env.slug}>
                  {env.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="save-secret-path">Folder</FieldLabel>
          <Input
            id="save-secret-path"
            value={secretPath}
            onChange={(event) => setSecretPath(event.target.value)}
            aria-invalid={submitted && !pathValid}
            autoComplete="off"
          />
          <FieldDescription>A folder path that starts with /, such as /nomen.</FieldDescription>
          {submitted && !pathValid && (
            <FieldError>Enter a folder path that starts with /.</FieldError>
          )}
        </Field>
        <Field>
          <FieldLabel htmlFor="save-secret-name">Secret name</FieldLabel>
          <Input
            id="save-secret-name"
            value={secretName}
            onChange={(event) => setSecretName(event.target.value)}
            aria-invalid={submitted && !nameValid}
            autoComplete="off"
            spellCheck={false}
          />
          {submitted && !nameValid && (
            <FieldError>Enter a name without colons or slashes.</FieldError>
          )}
        </Field>
        {snapshot.failedMessage && (
          <Alert variant="danger" role="alert">
            <AlertTitle>Not saved yet</AlertTitle>
            <AlertDescription>{snapshot.failedMessage}</AlertDescription>
          </Alert>
        )}
        <div className="flex gap-2">
          <Button
            type="submit"
            variant="project"
            isPending={snapshot.phase === "saving"}
            isDisabled={!canSave}
          >
            Save to Vaultix
          </Button>
          <Button
            type="button"
            variant="ghost"
            isDisabled={snapshot.phase === "saving"}
            onClick={() => sessionRef.current?.cancel()}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Shell>
  );
};

const routeApi = getRouteApi("/integrations/save-secret");

export const SaveSecretPage = () => {
  const { handoff, organizationId, user } = routeApi.useRouteContext();
  if (!handoff.ok) return <RequestError message={PROBLEMS[handoff.problem]} />;
  if (!organizationId || !user)
    return <RequestError message="Sign in to Vaultix, then try again." />;
  return <HandoffForm request={handoff.request} organizationId={organizationId} userId={user.id} />;
};
