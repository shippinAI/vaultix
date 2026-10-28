import { useCallback, useState } from "react";
import { Helmet } from "react-helmet";
import { useForm } from "react-hook-form";
import { useNavigate, useRouter } from "@tanstack/react-router";
import axios from "axios";

import { AuthPagePanel } from "@app/components/auth/AuthPagePanel";
import { OnboardingPageLayout } from "@app/components/auth/OnboardingPageLayout";
import {
  suggestOrganizationName,
  validateOrganizationName
} from "@app/components/auth/organization-name";
import SecurityClient from "@app/components/utilities/SecurityClient";
import {
  Alert,
  AlertDescription,
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
import { useCreateAdminUser, useSelectOrganization, useUpdateServerConfig } from "@app/hooks/api";

import { AdminSignUpForm } from "./components/AdminSignUpForm";
import { AdminSignUpFormData } from "./adminSignUpSchema";

export const SignUpPage = () => {
  const navigate = useNavigate();
  const router = useRouter();
  const [step, setStep] = useState<"organization" | "account">("organization");
  const [organizationName, setOrganizationName] = useState(suggestOrganizationName);
  const [createdOrganizationId, setCreatedOrganizationId] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [isFinishing, setIsFinishing] = useState(false);
  const focusHeading = useCallback((heading: HTMLHeadingElement | null) => heading?.focus(), []);
  const stepTitle =
    step === "organization" ? "Name Your Organization" : "Create Your Owner Account";
  const { mutateAsync: createAdminUser } = useCreateAdminUser();
  const { mutateAsync: selectOrganization } = useSelectOrganization();
  const { mutateAsync: updateServerConfig } = useUpdateServerConfig();
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors }
  } = useForm<{ organizationName: string }>({
    defaultValues: { organizationName }
  });

  const finishSetup = async (organizationId: string) => {
    await selectOrganization({ organizationId });
    localStorage.setItem("orgData.id", organizationId);
    await updateServerConfig({ onboardingCompleted: true });
    await router.invalidate();
    await navigate({ to: "/organizations/$orgId/projects", params: { orgId: organizationId } });
  };

  const handleCreate = async (values: AdminSignUpFormData) => {
    setIsFinishing(true);
    setFormError(undefined);
    let organizationId = createdOrganizationId;
    try {
      if (!organizationId) {
        const result = await createAdminUser({
          email: values.email,
          password: values.password,
          firstName: values.firstName,
          lastName: values.lastName || undefined,
          organizationName
        });
        organizationId = result.organization.id;
        // Unmount the password form immediately. Completion retries must never create another owner.
        setCreatedOrganizationId(organizationId);
        SecurityClient.setToken(result.token);
      }
      await finishSetup(organizationId);
    } catch (error) {
      const message = axios.isAxiosError<{ message?: string }>(error)
        ? error.response?.data?.message
        : undefined;
      setFormError(
        organizationId
          ? "Your account and organization were created. Retry opening your workspace, or sign in to finish setup."
          : message ||
              "Setup could not be confirmed. Try again, or sign in if your account was already created."
      );
    } finally {
      setIsFinishing(false);
    }
  };

  const retryFinish = async () => {
    if (!createdOrganizationId) return;
    setIsFinishing(true);
    setFormError(undefined);
    try {
      await finishSetup(createdOrganizationId);
    } catch {
      setFormError(
        "Your account is ready, but the workspace could not open. Retry or sign in to finish setup."
      );
    } finally {
      setIsFinishing(false);
    }
  };

  return (
    <OnboardingPageLayout currentStep={step === "organization" ? 1 : 2} totalSteps={2}>
      <Helmet>
        <title>Set Up Vaultix</title>
        <link rel="icon" href="/favicon.svg" />
      </Helmet>
      <AuthPagePanel>
        <CardHeader className="mb-6 gap-2">
          <CardTitle className="font-alliance text-2xl font-normal">
            <h1 ref={focusHeading} tabIndex={-1}>
              {createdOrganizationId ? "Open Your Workspace" : stepTitle}
            </h1>
          </CardTitle>
          <CardDescription className="text-base">
            {step === "organization"
              ? "Your business, team, brand, or personal workspace starts here. You can rename it later."
              : `Create your own sign-in for ${organizationName}. This account administers your Vaultix instance.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {formError && (
            <Alert variant="danger" role="alert">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
          {createdOrganizationId ? (
            <div className="space-y-4">
              <p className="text-sm text-muted">Your organization and owner account are saved.</p>
              <Button type="button" variant="project" isPending={isFinishing} onClick={retryFinish}>
                Open Workspace
              </Button>
              <Button type="button" variant="outline" onClick={() => navigate({ to: "/login" })}>
                Sign In
              </Button>
            </div>
          ) : null}
          {!createdOrganizationId && step === "organization" && (
            <>
              <GuidedHelp guideId="organization" />
              <form
                className="flex flex-col gap-5"
                noValidate
                onSubmit={handleSubmit((values) => {
                  setOrganizationName(values.organizationName.trim());
                  setFormError(undefined);
                  setStep("account");
                })}
              >
                <Field data-invalid={Boolean(errors.organizationName)}>
                  <div className="flex items-center justify-between gap-2">
                    <FieldLabel htmlFor="organization-name">Organization Name</FieldLabel>
                    <GuidanceHint guideId="organization" target="organization-name" />
                  </div>
                  <Input
                    variant="outlined"
                    {...register("organizationName", { validate: validateOrganizationName })}
                    id="organization-name"
                    autoComplete="organization"
                    maxLength={64}
                    aria-describedby={`organization-name-help${errors.organizationName ? " organization-name-error" : ""}`}
                    isError={Boolean(errors.organizationName)}
                  />
                  <p id="organization-name-help" className="text-sm text-muted">
                    Use your own name, such as Acme Studio or My Team, or keep this suggested name.
                  </p>
                  {errors.organizationName && (
                    <FieldError id="organization-name-error">
                      {errors.organizationName.message}
                    </FieldError>
                  )}
                </Field>
                <Button
                  id="organization-name-suggest"
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setValue("organizationName", suggestOrganizationName(), {
                      shouldValidate: true
                    })
                  }
                >
                  Suggest Another Name
                </Button>
                <Button id="organization-continue" type="submit" variant="project">
                  Continue to Owner Account
                </Button>
              </form>
            </>
          )}
          {!createdOrganizationId && step === "account" && (
            <>
              <GuidedHelp guideId="owner" />
              <p className="rounded-md border border-border p-3 text-sm text-muted">
                Choose your own password. Your instance starts invite-only with email and password
                sign-in. Configure federation later in settings.
              </p>
              <AdminSignUpForm
                onContinue={handleCreate}
                onBack={() => {
                  setFormError(undefined);
                  setStep("organization");
                }}
              />
            </>
          )}
        </CardContent>
      </AuthPagePanel>
    </OnboardingPageLayout>
  );
};
