import { FormEvent, useId, useRef } from "react";
import { useForm } from "react-hook-form";
import slugify from "@sindresorhus/slugify";

import {
  Button,
  DialogClose,
  DialogFooter,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input
} from "@app/components/v3";
import { GuidanceHint, GuidedHelp } from "@app/components/vaultix/GuidedHelp";

export type EnvironmentFormValues = { name: string; slug: string };

type Props = {
  initialValues?: EnvironmentFormValues;
  mode: "create" | "update";
  onSubmit: (values: EnvironmentFormValues) => Promise<void>;
};

export const EnvironmentForm = ({ initialValues, mode, onSubmit }: Props) => {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const guideId = mode === "create" ? "environment-create" : "environment-update";
  const submitting = useRef(false);
  const {
    register,
    handleSubmit,
    setValue,
    getFieldState,
    setError,
    clearErrors,
    formState: { errors, isSubmitting }
  } = useForm<EnvironmentFormValues>({ defaultValues: initialValues ?? { name: "", slug: "" } });

  const save = handleSubmit(async ({ name, slug }) => {
    clearErrors("root");
    try {
      await onSubmit({ name: name.trim(), slug: slug.trim() });
    } catch {
      // The shared mutation cache owns the detailed error notice; keep these edits for retry.
      setError("root.submit", {
        message:
          "The environment could not be saved. Your edits are kept. Check the error notice and retry."
      });
    }
  });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Guard before React Hook Form starts another submission/validation cycle.
    // A second Enter must not reset isSubmitting while the first request is pending.
    if (submitting.current) return;
    submitting.current = true;
    try {
      await save(event);
    } finally {
      submitting.current = false;
    }
  };

  return (
    <form
      ref={form}
      onSubmit={submit}
      noValidate
      aria-busy={isSubmitting}
      className="flex flex-col gap-6"
    >
      <Field>
        <FieldLabel htmlFor={`${id}-name`}>Environment Name</FieldLabel>
        <Input
          id={`${id}-name`}
          data-vaultix-guide-target="environment-name"
          readOnly={isSubmitting}
          isError={Boolean(errors.name)}
          aria-describedby={errors.name ? `${id}-name-error` : undefined}
          {...register("name", {
            validate: (value) =>
              (value.trim().length >= 1 && value.trim().length <= 255) ||
              "Enter an environment name between 1 and 255 characters.",
            onChange: (event) => {
              if (mode === "create" && !getFieldState("slug").isDirty) {
                setValue("slug", slugify(event.target.value, { lowercase: true }));
              }
            }
          })}
        />
        <div className="self-start">
          <GuidanceHint guideId={guideId} target="environment-name" targetScope={form} />
        </div>
        <FieldError id={`${id}-name-error`}>{errors.name?.message}</FieldError>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-slug`}>Environment Slug</FieldLabel>
        <Input
          id={`${id}-slug`}
          data-vaultix-guide-target="environment-slug"
          readOnly={isSubmitting}
          isError={Boolean(errors.slug)}
          aria-describedby={`${id}-slug-help${errors.slug ? ` ${id}-slug-error` : ""}`}
          autoCapitalize="none"
          spellCheck={false}
          {...register("slug", {
            validate: (value) => {
              const slug = value.trim();
              if (slug.length < 1 || slug.length > 64)
                return "Enter a slug between 1 and 64 characters.";
              return (
                slugify(slug, { lowercase: true }) === slug ||
                "Use lowercase letters, numbers and single hyphens between words."
              );
            }
          })}
        />
        <FieldError id={`${id}-slug-error`}>{errors.slug?.message}</FieldError>
        <FieldDescription id={`${id}-slug-help`}>
          {mode === "create"
            ? "Use this identifier in CLI commands, integrations and secret references. You can edit the suggestion."
            : "Changing this identifier can break CLI commands, integrations and references that use the old slug."}
        </FieldDescription>
        <div className="self-start">
          <GuidanceHint guideId={guideId} target="environment-slug" targetScope={form} />
        </div>
      </Field>
      {errors.root?.submit && (
        <p role="alert" className="text-sm text-muted">
          {errors.root.submit.message}
        </p>
      )}
      <p role="status" className="sr-only">
        {isSubmitting ? "Saving environment. Please wait." : ""}
      </p>
      <div className="self-start">
        <GuidedHelp guideId={guideId} targetScope={form} />
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="ghost" type="button" isDisabled={isSubmitting}>
            Cancel
          </Button>
        </DialogClose>
        <Button
          data-vaultix-guide-target="environment-save"
          type="submit"
          variant="project"
          isPending={isSubmitting}
          isDisabled={isSubmitting}
        >
          {mode === "create" ? "Create" : "Update"}
        </Button>
      </DialogFooter>
    </form>
  );
};
