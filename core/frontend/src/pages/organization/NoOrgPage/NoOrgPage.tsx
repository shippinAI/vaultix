import { useEffect, useRef, useState } from "react";
import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import axios from "axios";

import { AuthPageLayout } from "@app/components/auth/AuthPageLayout";
import { AuthPagePanel } from "@app/components/auth/AuthPagePanel";
import { createNotification } from "@app/components/notifications";
import { CreateOrgModal } from "@app/components/organization/CreateOrgModal";
import { ContentLoader } from "@app/components/v2";
import { Button, CardContent, CardDescription, CardHeader, CardTitle } from "@app/components/v3";
import {
  fetchOrganizations,
  organizationKeys,
  useCreateOrg,
  useLogoutUser,
  useSelectOrganization
} from "@app/hooks/api";
import { ApiErrorTypes } from "@app/hooks/api/types";

const PERSONAL_ORG_NAME = "Personal Org";
// A useRef gate resets on a full unmount/remount; this sessionStorage flag survives it, so an
// interrupted-then-remounted page can't fire a second createOrg and leave a duplicate org behind.
const CREATION_STARTED_KEY = "personalOrgCreationStarted";

const generatePersonalOrgName = (existingNames: string[]) => {
  const taken = new Set(existingNames.map((name) => name.trim().toLowerCase()));
  const isTaken = (candidate: string) => taken.has(candidate.trim().toLowerCase());

  if (!isTaken(PERSONAL_ORG_NAME)) return PERSONAL_ORG_NAME;

  let suffix = 1;
  while (isTaken(`${PERSONAL_ORG_NAME} ${suffix}`)) {
    suffix += 1;
  }
  return `${PERSONAL_ORG_NAME} ${suffix}`;
};

export const NoOrgPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // The invite-only state below explains this denial, so it does not also need a toast.
  const { mutateAsync: createOrg } = useCreateOrg({
    invalidate: false,
    handledErrorCodes: [ApiErrorTypes.CustomForbiddenError]
  });
  const { mutateAsync: selectOrg } = useSelectOrganization();
  const logout = useLogoutUser();

  // Guards against React strict-mode's double-invoke (and re-renders) creating two orgs.
  const hasRun = useRef(false);
  const [failed, setFailed] = useState(false);
  const [isInviteOnly, setIsInviteOnly] = useState(false);

  useEffect(() => {
    if (hasRun.current) return;

    hasRun.current = true;

    if (sessionStorage.getItem(CREATION_STARTED_KEY)) return;
    sessionStorage.setItem(CREATION_STARTED_KEY, "true");

    const createPersonalOrg = async () => {
      const existingOrgs = await fetchOrganizations().catch(() => []);
      const orgName = generatePersonalOrgName(existingOrgs.map((org) => org.name));

      let organization;
      try {
        organization = await createOrg({ name: orgName });
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 403) {
          // Signup is closed on this instance. Retrying or offering the form cannot succeed.
          sessionStorage.removeItem(CREATION_STARTED_KEY);
          setIsInviteOnly(true);
          return;
        }

        // Nothing was created, so reset both guards and let the user create an org manually.
        createNotification({
          text: "Couldn't create your organization automatically. Please create one below.",
          type: "error"
        });
        setFailed(true);
        hasRun.current = false;
        sessionStorage.removeItem(CREATION_STARTED_KEY);
        return;
      }

      try {
        await selectOrg({ organizationId: organization.id });

        localStorage.setItem("orgData.id", organization.id);

        navigate({
          to: "/organizations/$orgId/projects",
          params: { orgId: organization.id }
        });
      } catch {
        // The org was created but selecting it failed. Showing CreateOrgModal here would create a
        // second, orphaned org, so refresh the cached org list and hand off to the org picker,
        // which auto-selects the now-existing single org and finishes login.
        createNotification({
          text: "Created your organization, but couldn't open it automatically. Redirecting...",
          type: "error"
        });
        await queryClient.invalidateQueries({ queryKey: organizationKeys.getUserOrganizations });
        navigate({ to: "/login/select-organization" });
      } finally {
        sessionStorage.removeItem(CREATION_STARTED_KEY);
      }
    };

    createPersonalOrg();
  }, [createOrg, selectOrg, navigate, queryClient]);

  if (isInviteOnly) {
    return (
      <AuthPageLayout variant="focused">
        <Helmet>
          <title>Invitation Needed</title>
          <link rel="icon" href="/favicon.svg" />
        </Helmet>
        <AuthPagePanel>
          <CardHeader className="mb-6 gap-2 text-center">
            <CardTitle>
              <h1>You&apos;re not in an organization yet</h1>
            </CardTitle>
            <CardDescription role="status">
              This Vaultix instance is invite-only. Ask your administrator to invite you, then open
              the link in your invitation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="project"
              size="lg"
              isFullWidth
              isPending={logout.isPending}
              isDisabled={logout.isPending}
              onClick={async () => {
                await logout.mutateAsync();
                navigate({ to: "/login" });
              }}
            >
              Log Out
            </Button>
          </CardContent>
        </AuthPagePanel>
      </AuthPageLayout>
    );
  }

  return (
    <>
      <Helmet>
        <title>{t("common.head-title", { title: t("settings.org.title") })}</title>
        <link rel="icon" href="/favicon.svg" />
      </Helmet>
      <div className="min-h-screen bg-bunker-800">
        {failed ? (
          <CreateOrgModal isOpen logoutOnClose />
        ) : (
          <ContentLoader text="Setting up your organization..." />
        )}
      </div>
    </>
  );
};
