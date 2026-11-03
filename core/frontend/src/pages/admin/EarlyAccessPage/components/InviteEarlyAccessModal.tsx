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
import { GenericResourceNameSchema } from "@app/lib/schemas";

const validateOrganizationName = (value: string) => {
  const result = GenericResourceNameSchema.safeParse(value);
  return result.success || (result.error.issues[0]?.message ?? "Enter a valid name.");
};

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
              text: "The organization was created, but the invitation could not be delivered. Resend it from Resource Overview."
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
              ? `Email isn't available, so send this link to ${request?.email} yourself. Anyone with it can accept the invitation, and it won't be shown again.`
              : `This creates an organization for ${request?.email} and makes them its admin.`}
          </DialogDescription>
        </DialogHeader>
        {link && <InviteLink link={link} onClose={close} />}
        {!link && request && <InviteForm request={request} onClose={close} onLink={setLink} />}
      </DialogContent>
    </Dialog>
  );
};
