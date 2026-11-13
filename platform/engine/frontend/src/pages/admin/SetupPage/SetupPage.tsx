import { useState } from "react";
import { Helmet } from "react-helmet";
import { useNavigate, useRouter } from "@tanstack/react-router";

import { AuthPagePanel } from "@app/components/auth/AuthPagePanel";
import { OnboardingPageLayout } from "@app/components/auth/OnboardingPageLayout";
import {
  Alert,
  AlertDescription,
  Button,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@app/components/v3";
import { useOrganization, useServerConfig, useUser } from "@app/context";
import { useUpdateServerConfig } from "@app/hooks/api";

// Recovery after account creation: never asks for credentials again or creates a second organization.
export const SetupPage = () => {
  const navigate = useNavigate();
  const router = useRouter();
  const { config } = useServerConfig();
  const { user } = useUser();
  const { currentOrg } = useOrganization();
  const { mutateAsync: updateServerConfig } = useUpdateServerConfig();
  const [isFinishing, setIsFinishing] = useState(false);
  const [error, setError] = useState<string>();

  const finish = async () => {
    setIsFinishing(true);
    setError(undefined);
    try {
      await updateServerConfig({ onboardingCompleted: true });
      await router.invalidate();
      await navigate({ to: "/organizations/$orgId/projects", params: { orgId: currentOrg.id } });
    } catch {
      setError(
        "Your account and organization are saved. We could not open the workspace yet. Please retry."
      );
    } finally {
      setIsFinishing(false);
    }
  };

  return (
    <OnboardingPageLayout currentStep={2} totalSteps={2}>
      <Helmet>
        <title>Open Your Workspace | Vaultix</title>
        <link rel="icon" href="/favicon.svg" />
      </Helmet>
      <AuthPagePanel>
        <CardHeader className="mb-6 gap-2">
          <CardTitle className="font-alliance text-2xl font-normal">
            <h1>Your Workspace Is Ready</h1>
          </CardTitle>
          <CardDescription>
            Your owner account and organization have been created. Continue into Vaultix.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {error && (
            <Alert variant="danger" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <dl className="space-y-4 rounded-md border border-border p-4 text-sm">
            <div>
              <dt className="text-muted">Organization</dt>
              <dd className="break-words">{currentOrg.name}</dd>
            </div>
            <div>
              <dt className="text-muted">Signed in as</dt>
              <dd className="break-words">{user.email}</dd>
            </div>
            <div>
              <dt className="text-muted">New accounts</dt>
              <dd>
                {config.allowSignUp ? "Public signup enabled in this instance" : "Invite-only"}
              </dd>
            </div>
          </dl>
          <p className="text-sm text-muted">
            Invite teammates from your organization. Configure federation and instance access later
            in the Server Console.
          </p>
          <Button
            type="button"
            variant="project"
            isFullWidth
            isPending={isFinishing}
            onClick={finish}
          >
            Open Workspace
          </Button>
        </CardContent>
      </AuthPagePanel>
    </OnboardingPageLayout>
  );
};
