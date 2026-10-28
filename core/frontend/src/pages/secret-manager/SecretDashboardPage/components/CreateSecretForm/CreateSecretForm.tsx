import { ClipboardEvent, useId, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { AlertTriangleIcon, InfoIcon } from "lucide-react";

import { createNotification } from "@app/components/notifications";
import { VaultixSecretInput } from "@app/components/v2/VaultixSecretInput";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  CreatableSelect,
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  IconButton,
  Input,
  PasswordGenerator,
  SheetFooter,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@app/components/v3";
import {
  ProjectPermissionActions,
  ProjectPermissionSub,
  useProject,
  useProjectPermission
} from "@app/context";
import { getKeyValue } from "@app/helpers/parseEnvVar";
import { useCreateSecretV3, useCreateWsTag, useGetWsTags } from "@app/hooks/api";
import { PendingAction } from "@app/hooks/api/secretFolders/types";
import { SecretType } from "@app/hooks/api/types";

import {
  PendingSecretCreate,
  PopUpNames,
  useBatchModeActions,
  usePopUpAction
} from "../../SecretMainPage.store";

type TFormSchema = {
  key: string;
  value: string;
  tags: { label: string; value: string }[];
};

type Props = {
  environment: string;
  projectId: string;
  secretPath?: string;
  // modal props
  autoCapitalize?: boolean;
  isProtectedBranch?: boolean;
  isBatchMode?: boolean;
};

export const CreateSecretForm = ({
  environment,
  projectId,
  secretPath = "/",
  autoCapitalize = true,
  isProtectedBranch = false,
  isBatchMode = false
}: Props) => {
  const {
    handleSubmit,
    control,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting }
  } = useForm<TFormSchema>({ defaultValues: { key: "", value: "", tags: [] } });
  const formId = useId();
  const [submitFailed, setSubmitFailed] = useState(false);
  const { closePopUp } = usePopUpAction();

  const { mutateAsync: createSecretV3 } = useCreateSecretV3();
  const createWsTag = useCreateWsTag();
  const { addPendingChange } = useBatchModeActions();

  const { currentProject } = useProject();
  const { permission } = useProjectPermission();
  const canReadTags = permission.can(ProjectPermissionActions.Read, ProjectPermissionSub.Tags);
  const { data: projectTags, isPending: isTagsLoading } = useGetWsTags(
    canReadTags ? projectId : ""
  );

  const secretKeyInputRef = useRef<HTMLInputElement | null>(null);

  const secretKey = watch("key");

  const createNewTag = async (slug: string) => {
    const tagSlug = slug.trim().toLowerCase();
    if (!tagSlug) return;
    try {
      await createWsTag.mutateAsync({ projectId, tagSlug, tagColor: "" });
    } catch {
      // The shared mutation handler reports the server failure; keep the form intact.
    }
  };

  const handleFormSubmit = async (form: TFormSchema) => {
    const key = form.key.trim();
    const { value } = form;
    const tags = form.tags.map((tag) => ({ label: tag.label.trim(), value: tag.value.trim() }));
    setSubmitFailed(false);
    if (isBatchMode) {
      const pendingSecretCreate: PendingSecretCreate = {
        id: key,
        type: PendingAction.Create,
        secretKey: key,
        secretValue: value || "",
        secretComment: "",
        tags: tags?.map((el) => ({ id: el.value, slug: el.label })),
        timestamp: Date.now(),
        resourceType: "secret"
      };
      addPendingChange(pendingSecretCreate, {
        projectId,

        environment,
        secretPath
      });
      closePopUp(PopUpNames.CreateSecretForm);
      reset();
      return;
    }
    try {
      await createSecretV3({
        environment,
        projectId,
        secretPath,
        secretKey: key,
        secretValue: value || "",
        secretComment: "",
        type: SecretType.Shared,
        tagIds: tags.map((el) => el.value)
      });
    } catch {
      setSubmitFailed(true);
      return;
    }
    closePopUp(PopUpNames.CreateSecretForm);
    reset();

    createNotification({
      type: isProtectedBranch ? "info" : "success",
      text: isProtectedBranch
        ? "Requested changes have been sent for review"
        : "Successfully created secret"
    });
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const delimitters = [":", "="];
    const pastedContent = e.clipboardData.getData("text");
    const { key, value, hasAssignment } = getKeyValue(pastedContent, delimitters);

    const isWholeKeyHighlighted =
      secretKeyInputRef.current &&
      secretKeyInputRef.current.selectionStart === 0 &&
      secretKeyInputRef.current.selectionEnd === secretKeyInputRef.current.value.length;

    if (!secretKey || isWholeKeyHighlighted) {
      e.preventDefault();
      const keyStr = autoCapitalize ? key.toUpperCase() : key;
      setValue("key", keyStr);
      if (hasAssignment) {
        setValue("value", value);
      }
    }
  };

  return (
    <form
      onSubmit={handleSubmit(handleFormSubmit)}
      noValidate
      className="flex flex-1 flex-col overflow-hidden"
    >
      <div className="flex thin-scrollbar flex-1 flex-col gap-4 overflow-y-auto p-4">
        <Controller
          control={control}
          name="key"
          rules={{ validate: (value) => Boolean(value.trim()) || "Secret key is required" }}
          render={({ field, fieldState: { error } }) => (
            <Field>
              <FieldLabel htmlFor={`${formId}-key`}>Key</FieldLabel>
              <FieldContent>
                <div className="relative">
                  <Input
                    {...field}
                    id={`${formId}-key`}
                    aria-required
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? `${formId}-key-error` : undefined}
                    ref={(element) => {
                      secretKeyInputRef.current = element;
                      field.ref(element);
                    }}
                    onChange={(event) =>
                      field.onChange(
                        autoCapitalize ? event.target.value.toUpperCase() : event.target.value
                      )
                    }
                    onPaste={handlePaste}
                    placeholder="Type your secret name"
                    autoComplete="off"
                    autoFocus
                    isError={Boolean(error)}
                  />
                  {secretKey.includes(" ") && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <IconButton
                          aria-label="Secret key whitespace help"
                          variant="ghost"
                          size="xs"
                          className="absolute top-1/2 right-1 -translate-y-1/2 text-warning"
                        >
                          <AlertTriangleIcon />
                        </IconButton>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-72">
                        This key contains spaces. Use{" "}
                        <code>{encodeURIComponent(secretKey.trim())}</code> when making API
                        requests.
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
                <FieldError id={`${formId}-key-error`} errors={[error]} />
              </FieldContent>
            </Field>
          )}
        />
        <Controller
          control={control}
          name="value"
          render={({ field }) => (
            <Field>
              <div className="flex items-center gap-1">
                <FieldLabel htmlFor={`${formId}-value`}>Value</FieldLabel>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <IconButton aria-label="Secret reference help" variant="ghost" size="xs">
                      <InfoIcon />
                    </IconButton>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-72">
                    Reference another secret with{" "}
                    <code>
                      &#36;{"{"}secret_name{"}"}
                    </code>
                    . Hold Cmd on Mac or Ctrl on Windows/Linux and click a reference to navigate to
                    it.
                  </TooltipContent>
                </Tooltip>
              </div>
              <FieldContent>
                <div className="flex items-start gap-2">
                  <VaultixSecretInput
                    {...field}
                    id={`${formId}-value`}
                    aria-label="Value"
                    environment={environment}
                    secretPath={secretPath}
                    containerClassName="min-w-0 border border-border bg-container px-3 py-2 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/50"
                  />
                  <PasswordGenerator
                    onUsePassword={field.onChange}
                    projectId={projectId}
                    selectedEnvironments={[{ slug: environment }]}
                    secretPath={secretPath}
                    environments={currentProject?.environments}
                  />
                </div>
                <FieldError errors={[errors.value]} />
              </FieldContent>
            </Field>
          )}
        />
        <Controller
          control={control}
          name="tags"
          render={({ field }) => (
            <Field>
              <FieldLabel htmlFor={`${formId}-tags`}>Tags</FieldLabel>
              <FieldContent>
                <CreatableSelect
                  inputId={`${formId}-tags`}
                  isMulti
                  className="w-full"
                  placeholder="Select tags to assign to secret..."
                  isValidNewOption={(value) => Boolean(value.trim())}
                  name={field.name}
                  isDisabled={!canReadTags}
                  isLoading={isTagsLoading && canReadTags}
                  options={projectTags?.map((tag) => ({ label: tag.slug, value: tag.id }))}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  onCreateOption={createNewTag}
                  aria-describedby={!canReadTags ? `${formId}-tags-help` : undefined}
                />
                {!canReadTags && (
                  <FieldDescription id={`${formId}-tags-help`}>
                    You do not have permission to read tags.
                  </FieldDescription>
                )}
                <FieldError errors={[errors.tags]} />
              </FieldContent>
            </Field>
          )}
        />
        {submitFailed && (
          <Alert variant="danger" role="status">
            <AlertTriangleIcon />
            <AlertTitle>Creation needs attention</AlertTitle>
            <AlertDescription>
              Your entries are preserved. Resolve the reported error, then retry.
            </AlertDescription>
          </Alert>
        )}
      </div>
      <SheetFooter>
        <Button variant="project" type="submit" isDisabled={isSubmitting} isPending={isSubmitting}>
          Create Secret
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => closePopUp(PopUpNames.CreateSecretForm)}
        >
          Cancel
        </Button>
      </SheetFooter>
    </form>
  );
};
