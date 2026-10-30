import { useRef, useState } from "react";
import { Fingerprint, HelpCircle } from "lucide-react";

import { createNotification } from "@app/components/notifications";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@app/components/v3";
import {
  OrgPermissionActions,
  OrgPermissionSubjects,
  useOrganization,
  useOrgPermission
} from "@app/context";
import { useFetchServerStatus, useUpdateOrg } from "@app/hooks/api";
import { MfaMethod } from "@app/hooks/api/auth/types";
import { Organization } from "@app/hooks/api/organization/types";

const methods = {
  [MfaMethod.EMAIL]: { label: "Email", description: "Members receive a sign-in code by email." },
  [MfaMethod.TOTP]: {
    label: "Mobile Authenticator",
    description: "Members use a time-based code from their authenticator app."
  },
  [MfaMethod.WEBAUTHN]: {
    label: "Passkey (WebAuthn)",
    description: "Members use a registered WebAuthn credential."
  }
};
type MfaSettings = { enforced: boolean; method: MfaMethod };
type MfaDraft = MfaSettings & { original: MfaSettings };

const MfaSettingsForm = ({ org }: { org: Organization }) => {
  const { permission } = useOrgPermission();
  const canEdit = permission.can(OrgPermissionActions.Edit, OrgPermissionSubjects.Settings);
  const { data: serverStatus } = useFetchServerStatus();
  const { mutateAsync, isPending } = useUpdateOrg();
  const [draft, setDraft] = useState<MfaDraft | null>(null);
  const [review, setReview] = useState<MfaDraft | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const saving = useRef(false);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const savedStatus = useRef<HTMLParagraphElement>(null);
  const explanation = useRef<HTMLParagraphElement>(null);
  const current: MfaSettings = {
    enforced: Boolean(org.enforceMfa),
    method: org.selectedMfaMethod ?? MfaMethod.EMAIL
  };
  const proposed = draft ?? current;
  const changed = proposed.enforced !== current.enforced || proposed.method !== current.method;
  const original = review?.original ?? draft?.original;
  const stale = Boolean(
    original && (original.enforced !== current.enforced || original.method !== current.method)
  );

  const edit = (change: Partial<MfaSettings>) => {
    if (!canEdit || saving.current) return;
    setSaveFailed(false);
    setDraft((previous) => ({ ...(previous ?? { ...current, original: current }), ...change }));
  };

  const save = async () => {
    if (!review || !canEdit || stale || saving.current) return;
    saving.current = true;
    setSaveFailed(false);
    try {
      await mutateAsync({
        orgId: org.id,
        ...(review.enforced !== current.enforced ? { enforceMfa: review.enforced } : {}),
        ...(review.method !== current.method ? { selectedMfaMethod: review.method } : {})
      });
      setDraft(null);
      setReview(null);
      createNotification({ text: `MFA settings updated for ${org.name}`, type: "success" });
    } catch {
      // The shared mutation handler reports the service error once.
      setSaveFailed(true);
    } finally {
      saving.current = false;
    }
  };
  const failure = (
    <p role="alert" className="text-sm text-danger">
      Could not confirm the change. Your draft is preserved. Check the error notification; if the
      connection was lost, reload the page to check the saved settings before retrying.
    </p>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex-wrap">
          <Fingerprint className="size-4 text-accent" aria-hidden="true" />
          Multi-Factor Authentication
          <Badge variant={current.enforced ? "success" : "neutral"}>
            {current.enforced ? "Required" : "Optional"}
          </Badge>
        </CardTitle>
        <CardDescription className="text-muted">
          Set organization-wide sign-in safeguards. Review your changes before applying them.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p ref={savedStatus} tabIndex={-1} role="status" className="text-sm text-muted">
          {isPending
            ? `Saving MFA settings for ${org.name}…`
            : `Saved policy: MFA ${current.enforced ? "required" : "optional"}. Configured method: ${methods[current.method].label}.`}
        </p>
        <FieldGroup>
          <Field>
            <div className="flex flex-wrap items-center gap-3">
              <FieldLabel htmlFor="enforce-org-mfa">Require MFA for Members</FieldLabel>
              <Tooltip disableHoverableContent={false}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="About MFA enforcement"
                    onClick={() => explanation.current?.focus()}
                    className="flex size-11 items-center justify-center rounded-md text-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <HelpCircle className="size-4" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="pointer-events-auto max-w-64 motion-reduce:animate-none">
                  Require a second authentication factor for members. Select for the explanation
                  below.
                </TooltipContent>
              </Tooltip>
              <Switch
                id="enforce-org-mfa"
                aria-describedby="org-mfa-explanation"
                variant="org"
                checked={proposed.enforced}
                onCheckedChange={(enforced) => edit({ enforced })}
                disabled={!canEdit || isPending}
              />
            </div>
            <p
              ref={explanation}
              id="org-mfa-explanation"
              tabIndex={-1}
              className="text-sm text-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              Require a second factor when members authenticate into this organization. Turning this
              off does not disable MFA that members enabled for their own accounts.
            </p>
          </Field>
          <Field>
            <FieldLabel htmlFor="org-mfa-method">MFA Method</FieldLabel>
            <Select
              value={proposed.method}
              onValueChange={(value) => edit({ method: value as MfaMethod })}
              disabled={!canEdit || isPending}
            >
              <SelectTrigger
                id="org-mfa-method"
                aria-describedby="org-mfa-method-help"
                className="w-full max-w-sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(methods).map(([value, method]) => (
                  <SelectItem key={value} value={value}>
                    {method.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription id="org-mfa-method-help">
              {methods[proposed.method].description} This method is required when organization MFA
              is enforced. Members manage their enrolled factors in their own account.
            </FieldDescription>
          </Field>
        </FieldGroup>
        {serverStatus?.emailConfigured === false && (
          <p className="text-sm text-muted">
            This instance requires email delivery before changing MFA enforcement. Ask your instance
            administrator to configure SMTP. Changing only the configured method does not turn MFA
            on.
          </p>
        )}
        {!canEdit && (
          <p className="text-sm text-muted">
            You need permission to edit organization settings to change MFA.
          </p>
        )}
        {stale && (
          <p role="alert" className="text-sm text-warning">
            Saved MFA settings changed while you were editing. Reset your draft to use the latest
            settings before reviewing another change.
          </p>
        )}
        {saveFailed && !review && failure}
        <div className="flex flex-wrap gap-2">
          <Button
            ref={reviewButton}
            variant="org"
            isDisabled={!canEdit || !changed || stale || isPending}
            onClick={() => setReview(draft)}
          >
            Review MFA Change
          </Button>
          <Button
            variant="outline"
            isDisabled={!draft || isPending}
            onClick={() => {
              setDraft(null);
              setSaveFailed(false);
            }}
          >
            Reset Draft
          </Button>
        </div>
        <Dialog open={Boolean(review)} onOpenChange={(open) => !open && setReview(null)}>
          <DialogContent
            className="motion-reduce:animate-none"
            overlayClassName="motion-reduce:animate-none"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (reviewButton.current && !reviewButton.current.disabled)
                reviewButton.current.focus();
              else savedStatus.current?.focus();
            }}
          >
            <DialogHeader>
              <DialogTitle>Review MFA Change</DialogTitle>
              <DialogDescription className="text-muted">
                Apply this sign-in policy to {org.name}. Review the saved and proposed settings.
              </DialogDescription>
            </DialogHeader>
            {review && (
              <dl className="grid gap-3 text-sm">
                <div>
                  <dt className="font-medium">Saved Policy</dt>
                  <dd className="text-muted">
                    MFA {current.enforced ? "required" : "optional"} ·{" "}
                    {methods[current.method].label}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">Proposed Policy</dt>
                  <dd className="text-muted">
                    MFA {review.enforced ? "required" : "optional"} · {methods[review.method].label}
                  </dd>
                </div>
              </dl>
            )}
            {review && current.enforced && !review.enforced && (
              <p className="text-sm text-warning">
                Members without personal MFA will no longer be required to use a second factor by
                this organization.
              </p>
            )}
            {stale && (
              <p role="alert">Saved settings changed. Close this review and reset your draft.</p>
            )}
            {!canEdit && (
              <p role="alert">You no longer have permission to edit organization settings.</p>
            )}
            {saveFailed && failure}
            {isPending && (
              <p role="status" className="text-sm text-muted">
                Saving… Closing this review does not cancel the request.
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setReview(null)}>
                {isPending ? "Close" : "Back to Editing"}
              </Button>
              <Button
                variant={review && !review.enforced && current.enforced ? "warning" : "org"}
                isPending={isPending}
                isDisabled={!canEdit || stale || isPending}
                onClick={save}
              >
                Apply MFA Change
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
};

export const OrgGenericAuthSection = () => {
  const { currentOrg } = useOrganization();
  return <MfaSettingsForm key={currentOrg.id} org={currentOrg} />;
};
