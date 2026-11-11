import { Controller, useForm } from "react-hook-form";

import { createNotification } from "@app/components/notifications";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  TextArea
} from "@app/components/v3";
import {
  TAssistantCredential,
  TAssistantProvider,
  TAssistantProviderKind,
  useCreateAssistantProvider,
  useUpdateAssistantProvider
} from "@app/hooks/api/assistant";

export const PROVIDER_KINDS: { kind: TAssistantProviderKind; label: string; model: string }[] = [
  { kind: "anthropic", label: "Anthropic (Claude API)", model: "claude-sonnet-5-5" },
  { kind: "bedrock", label: "Claude on AWS Bedrock", model: "" },
  { kind: "vertex", label: "Claude on Google Vertex AI", model: "" },
  { kind: "openai", label: "OpenAI", model: "" },
  { kind: "openai-compatible", label: "Your own server (vLLM, Ollama)", model: "" }
];

export const kindLabel = (kind: TAssistantProviderKind) =>
  PROVIDER_KINDS.find((entry) => entry.kind === kind)?.label ?? kind;

type FormValues = {
  kind: TAssistantProviderKind;
  name: string;
  model: string;
  baseUrl: string;
  region: string;
  cloudProject: string;
  apiKey: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  serviceAccountJson: string;
  active: boolean;
};

const credentialFor = (values: FormValues): TAssistantCredential | undefined => {
  switch (values.kind) {
    case "bedrock":
      return values.accessKeyId || values.secretAccessKey
        ? {
            accessKeyId: values.accessKeyId,
            secretAccessKey: values.secretAccessKey,
            sessionToken: values.sessionToken || undefined
          }
        : undefined;
    case "vertex":
      return values.serviceAccountJson
        ? { serviceAccountJson: values.serviceAccountJson }
        : undefined;
    default:
      return values.apiKey ? { apiKey: values.apiKey } : undefined;
  }
};

type Props = {
  provider?: TAssistantProvider;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

export const ProviderDialog = ({ provider, isOpen, onOpenChange }: Props) => {
  const createProvider = useCreateAssistantProvider();
  const updateProvider = useUpdateAssistantProvider();
  const editing = Boolean(provider);
  const {
    control,
    register,
    handleSubmit,
    watch,
    reset,
    formState: { isSubmitting }
  } = useForm<FormValues>({
    values: {
      kind: provider?.kind ?? "anthropic",
      name: provider?.name ?? "",
      model: provider?.model ?? "claude-sonnet-5-5",
      baseUrl: provider?.baseUrl ?? "",
      region: provider?.region ?? "",
      cloudProject: provider?.cloudProject ?? "",
      apiKey: "",
      accessKeyId: "",
      secretAccessKey: "",
      sessionToken: "",
      serviceAccountJson: "",
      active: provider?.active ?? true
    }
  });
  const kind = watch("kind");

  const close = () => {
    reset();
    onOpenChange(false);
  };

  const onSubmit = async (values: FormValues) => {
    const credential = credentialFor(values);
    const input = {
      name: values.name,
      model: values.model,
      baseUrl: values.baseUrl,
      region: values.region,
      cloudProject: values.cloudProject,
      credential,
      active: values.active
    };
    try {
      if (provider) {
        await updateProvider.mutateAsync({ id: provider.id, ...input });
        createNotification({
          type: "success",
          text: `Saved ${values.name}. Test it to confirm it answers.`
        });
      } else {
        await createProvider.mutateAsync({ kind: values.kind, ...input });
        createNotification({
          type: "success",
          text: `Added ${values.name}. Test it to confirm it answers.`
        });
      }
      close();
    } catch {
      // The shared mutation handler shows the server's reason; the form stays open.
    }
  };

  const keyHint = editing
    ? "Leave empty to keep the stored key. It is never shown again."
    : "Stored encrypted. It is never shown again.";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => (open ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${provider?.name}` : "Add an AI provider"}</DialogTitle>
          <DialogDescription>
            The assistant only ever sends this provider names, references and what people type in
            chat. Secret values never leave Vaultix.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <Field>
            <FieldLabel htmlFor="ai-provider-kind">Provider</FieldLabel>
            <Controller
              control={control}
              name="kind"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={editing}>
                  <SelectTrigger id="ai-provider-kind" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDER_KINDS.map((entry) => (
                      <SelectItem key={entry.kind} value={entry.kind}>
                        {entry.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="ai-provider-name">Name</FieldLabel>
            <Input
              id="ai-provider-name"
              placeholder="Claude for the assistant"
              {...register("name")}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="ai-provider-model">Model ID</FieldLabel>
            <Input
              id="ai-provider-model"
              placeholder={
                kind === "bedrock"
                  ? "anthropic.claude-… or an inference profile ID"
                  : "claude-sonnet-5-5"
              }
              {...register("model")}
            />
          </Field>
          {(kind === "openai-compatible" || kind === "anthropic" || kind === "openai") && (
            <Field>
              <FieldLabel htmlFor="ai-provider-base-url">
                Base URL{kind === "openai-compatible" ? "" : " (optional)"}
              </FieldLabel>
              <Input
                id="ai-provider-base-url"
                placeholder={
                  kind === "openai-compatible"
                    ? "http://gpu-host:8000/v1"
                    : "Leave empty for the provider's own address"
                }
                {...register("baseUrl")}
              />
            </Field>
          )}
          {(kind === "bedrock" || kind === "vertex") && (
            <Field>
              <FieldLabel htmlFor="ai-provider-region">Region</FieldLabel>
              <Input
                id="ai-provider-region"
                placeholder={kind === "bedrock" ? "us-east-1" : "us-east5 or global"}
                {...register("region")}
              />
            </Field>
          )}
          {kind === "vertex" && (
            <>
              <Field>
                <FieldLabel htmlFor="ai-provider-project">Google Cloud project ID</FieldLabel>
                <Input id="ai-provider-project" {...register("cloudProject")} />
              </Field>
              <Field>
                <FieldLabel htmlFor="ai-provider-account">Service account key (JSON)</FieldLabel>
                <TextArea
                  id="ai-provider-account"
                  rows={4}
                  autoComplete="off"
                  spellCheck={false}
                  {...register("serviceAccountJson")}
                />
                <FieldDescription>{keyHint}</FieldDescription>
              </Field>
            </>
          )}
          {kind === "bedrock" && (
            <>
              <Field>
                <FieldLabel htmlFor="ai-provider-access-key">AWS access key ID</FieldLabel>
                <Input
                  id="ai-provider-access-key"
                  autoComplete="off"
                  {...register("accessKeyId")}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="ai-provider-secret-key">AWS secret access key</FieldLabel>
                <Input
                  id="ai-provider-secret-key"
                  type="password"
                  autoComplete="new-password"
                  {...register("secretAccessKey")}
                />
                <FieldDescription>{keyHint}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="ai-provider-session-token">
                  Session token (optional)
                </FieldLabel>
                <Input
                  id="ai-provider-session-token"
                  type="password"
                  autoComplete="new-password"
                  {...register("sessionToken")}
                />
              </Field>
            </>
          )}
          {kind !== "bedrock" && kind !== "vertex" && (
            <Field>
              <FieldLabel htmlFor="ai-provider-key">
                API key{kind === "openai-compatible" ? " (optional)" : ""}
              </FieldLabel>
              <Input
                id="ai-provider-key"
                type="password"
                autoComplete="new-password"
                {...register("apiKey")}
              />
              <FieldDescription>{keyHint}</FieldDescription>
            </Field>
          )}
          <Field orientation="horizontal">
            <FieldLabel htmlFor="ai-provider-active">Use for the assistant</FieldLabel>
            <Controller
              control={control}
              name="active"
              render={({ field }) => (
                <Switch
                  id="ai-provider-active"
                  variant="neutral"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              )}
            />
          </Field>
          <DialogFooter>
            <Button variant="ghost" type="button" onClick={close}>
              Cancel
            </Button>
            <Button variant="neutral" type="submit" isPending={isSubmitting}>
              {editing ? "Save" : "Add provider"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
