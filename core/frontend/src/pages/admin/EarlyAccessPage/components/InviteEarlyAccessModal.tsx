import { useState } from "react";
import { useForm } from "react-hook-form";

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
  FieldError,
  FieldLabel,
  Input
} from "@app/components/v3";
import { TEarlyAccessRequest, useInviteEarlyAccessRequest } from "@app/hooks/api/earlyAccess";

// The rule the existing organization route applies to a name.
const validateOrganizationName = (value: string) => {
  const name = value.trim();
  if (!name) return "Name must be at least 1 character";
  if (name.length > 64) return "Name must be 64 or fewer characters";
  return (
    /^[a-zA-Z0-9_ -]+$/.test(name) ||
    "Name can only contain alphanumeric characters, dashes, underscores, and spaces"
  );
};

const describeLink = (email?: string) =>
  `Email isn't available, so send this link to ${email} yourself, at that address only. Whoever holds it can set up that account. It expires in 72 hours and won't be shown again.`;

const InviteForm = ({
  request,
  onClose,
  onLink
}: {
  request: TEarlyAccessRequest;
  onClose: () => void;
  onLink: (link: string) => void;
}) => {
  const inviteRequest = useInviteEarlyAccessRequest();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<{ organizationName: string }>({
    defaultValues: { organizationName: request.organization ?? "" }
  });

  const onSubmit = async ({ organizationName }: { organizationName: string }) => {
    try {
      const { invitation } = await inviteRequest.mutateAsync({
        requestId: request.id,
        organizationName
      });
      if (invitation?.delivery === "link") {
        onLink(invitation.link);
        return;
      }
      createNotification(
        invitation?.delivery === "email"
          ? { type: "success", text: `Invitation emailed to ${request.email}.` }
          : {
              type: "error",
              text: "The organization was created, but the invitation could not be delivered. Use Send a new invitation on this request."
            }
      );
      onClose();
    } catch {
      // The shared mutation handler reports the failure, and the form stays open to retry.
    }
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
      <Field>
        <FieldLabel htmlFor="early-access-organization-name">New organization name</FieldLabel>
        <Input
          id="early-access-organization-name"
          autoFocus
          aria-describedby={errors.organizationName ? "early-access-organization-error" : undefined}
          isError={Boolean(errors.organizationName)}
          {...register("organizationName", { validate: validateOrganizationName })}
        />
        <FieldError id="early-access-organization-error">
          {errors.organizationName?.message}
        </FieldError>
      </Field>
      <DialogFooter>
        <Button variant="ghost" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="neutral" type="submit" isPending={isSubmitting}>
          Create and invite
        </Button>
      </DialogFooter>
    </form>
  );
};

const InviteLink = ({ link, onClose }: { link: string; onClose: () => void }) => (
  <div className="flex flex-col gap-4">
    <Field>
      <FieldLabel htmlFor="early-access-invite-link">Invitation link</FieldLabel>
      <Input
        id="early-access-invite-link"
        readOnly
        value={link}
        onFocus={(event) => event.target.select()}
      />
    </Field>
    <DialogFooter>
      <Button
        variant="ghost"
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(link);
            createNotification({ type: "success", text: "Invitation link copied." });
          } catch {
            createNotification({
              type: "error",
              text: "Could not copy the link. Select it and copy it yourself."
            });
          }
        }}
      >
        Copy link
      </Button>
      <Button variant="neutral" type="button" onClick={onClose}>
        Done
      </Button>
    </DialogFooter>
  </div>
);

export const InvitationLinkModal = ({
  invitation,
  onClose
}: {
  invitation: { email: string; link: string } | undefined;
  onClose: () => void;
}) => (
  <Dialog open={Boolean(invitation)} onOpenChange={(isOpen) => !isOpen && onClose()}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader className="text-left">
        <DialogTitle>Share this invitation</DialogTitle>
        <DialogDescription>{describeLink(invitation?.email)}</DialogDescription>
      </DialogHeader>
      {invitation && <InviteLink link={invitation.link} onClose={onClose} />}
    </DialogContent>
  </Dialog>
);

export const InviteEarlyAccessModal = ({
  request,
  onClose
}: {
  request: TEarlyAccessRequest | undefined;
  onClose: () => void;
}) => {
  const [link, setLink] = useState<string>();
  const close = () => {
    setLink(undefined);
    onClose();
  };

  return (
    <Dialog open={Boolean(request)} onOpenChange={(isOpen) => !isOpen && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="text-left">
          <DialogTitle>{link ? "Share this invitation" : "Invite to Vaultix"}</DialogTitle>
          <DialogDescription>
            {link
              ? describeLink(request?.email)
              : `This creates an organization for ${request?.email} and makes them its admin. Anyone can submit any address, so the details on this request may not come from its owner.`}
          </DialogDescription>
        </DialogHeader>
        {link && <InviteLink link={link} onClose={close} />}
        {!link && request && <InviteForm request={request} onClose={close} onLink={setLink} />}
      </DialogContent>
    </Dialog>
  );
};
