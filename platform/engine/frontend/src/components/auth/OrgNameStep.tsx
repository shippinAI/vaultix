import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "@tanstack/react-router";

import {
  Button,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldError,
  FieldLabel,
  Input
} from "@app/components/v3";
import { GuidanceHint, GuidedHelp } from "@app/components/vaultix/GuidedHelp";
import { useCreateOrg } from "@app/hooks/api";
import { useSelectOrganization } from "@app/hooks/api/auth/queries";

import { AuthPagePanel } from "./AuthPagePanel";
import { suggestOrganizationName, validateOrganizationName } from "./organization-name";

type OrgNameFormData = { organizationName: string };

interface OrgNameStepProps {
  onComplete: (orgId: string) => void;
}

export default function OrgNameStep({ onComplete }: OrgNameStepProps): JSX.Element {
  const navigate = useNavigate();
  const [suggestedName] = useState(suggestOrganizationName);
  const [createdOrgId, setCreatedOrgId] = useState<string>();
  const { mutateAsync: createOrg, isPending: isCreating } = useCreateOrg({ invalidate: false });
  const { mutateAsync: selectOrganization, isPending: isSelecting } = useSelectOrganization();

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors }
  } = useForm<OrgNameFormData>({
    defaultValues: { organizationName: suggestedName }
  });

  const onSubmit = async ({ organizationName }: OrgNameFormData) => {
    try {
      const organizationId =
        createdOrgId ?? (await createOrg({ name: organizationName.trim() })).id;
      setCreatedOrgId(organizationId);
      const { isMfaEnabled } = await selectOrganization({ organizationId });
      if (isMfaEnabled) {
        navigate({
          to: "/login/select-organization",
          search: { org_id: organizationId }
        });
        return;
      }
      localStorage.setItem("orgData.id", organizationId);
      onComplete(organizationId);
    } catch {
      // The global mutation error handler already surfaces a toast; stay on this step.
    }
  };

  return (
    <div className="mx-auto flex w-full flex-col items-center justify-center">
      <AuthPagePanel>
        <CardHeader className="mb-4 gap-2">
          <CardTitle className="bg-linear-to-b from-white to-bunker-200 bg-clip-text font-alliance text-2xl font-normal text-transparent">
            <h1>Name Your Organization</h1>
          </CardTitle>
          <CardDescription className="text-sm text-label">
            Name your business, team, brand, or personal workspace. You can rename it later.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <GuidedHelp guideId="organization" />
          {createdOrgId && (
            <p role="status" className="text-sm text-muted">
              Your organization is saved. Continue to open it.
            </p>
          )}
          <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit(onSubmit)}>
            <Field data-invalid={Boolean(errors.organizationName)}>
              <div className="flex items-center justify-between gap-2">
                <FieldLabel htmlFor="organization-name">Organization Name</FieldLabel>
                <GuidanceHint guideId="organization" target="organization-name" />
              </div>
              <Input
                variant="outlined"
                {...register("organizationName", { validate: validateOrganizationName })}
                id="organization-name"
                readOnly={Boolean(createdOrgId)}
                aria-describedby={`organization-name-help${errors.organizationName ? " organization-name-error" : ""}`}
                placeholder="Organization Name"
                maxLength={64}
                autoComplete="organization"
                isError={Boolean(errors.organizationName)}
              />
              <p id="organization-name-help" className="text-sm text-muted">
                For example, Acme Studio or My Team. You can keep the suggestion or enter your own
                name.
              </p>
              {errors.organizationName ? (
                <FieldError id="organization-name-error">
                  {errors.organizationName.message}
                </FieldError>
              ) : null}
            </Field>
            <Button
              type="button"
              id="organization-name-suggest"
              variant="outline"
              isDisabled={Boolean(createdOrgId) || isCreating || isSelecting}
              onClick={() =>
                setValue("organizationName", suggestOrganizationName(), { shouldValidate: true })
              }
            >
              Suggest Another Name
            </Button>
            <Button
              id="organization-continue"
              type="submit"
              variant="project"
              size="lg"
              isFullWidth
              isPending={isCreating || isSelecting}
            >
              Continue
            </Button>
          </form>
        </CardContent>
      </AuthPagePanel>
    </div>
  );
}
