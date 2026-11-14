import { useState } from "react";

import {
  Button,
  CopyButton,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@app/components/v3";
import { TPasswordResetLink, useCreatePasswordResetLink } from "@app/hooks/api/admin";

type Props = {
  user: { id: string; username: string } | null;
  onClose: () => void;
};

// The link is held only in this dialog's memory and disappears when it closes.
export const PasswordResetLinkDialog = ({ user, onClose }: Props) => {
  const createLink = useCreatePasswordResetLink();
  const [link, setLink] = useState<TPasswordResetLink | null>(null);

  const close = () => {
    setLink(null);
    createLink.reset();
    onClose();
  };

  const issue = async () => {
    if (!user) return;
    try {
      setLink(await createLink.mutateAsync(user.id));
    } catch {
      // The shared mutation handler shows the reason.
    }
  };

  return (
    <Dialog open={Boolean(user)} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Password reset link for {user?.username}</DialogTitle>
          <DialogDescription>
            For when email is not set up or not reaching them. The link lets whoever holds it set a
            new password for this account, so give it to {user?.username} directly. It works once
            and expires in 24 hours. Creating a new link cancels any earlier link or reset email.
          </DialogDescription>
        </DialogHeader>
        {link ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-md border border-border p-2">
              <code className="min-w-0 flex-1 text-xs break-all">{link.url}</code>
              <CopyButton value={link.url} ariaLabel="Copy the reset link" />
            </div>
            <p role="status" className="text-xs text-muted">
              Expires {new Date(link.expiresAt).toLocaleString()}. Vaultix will not show this link
              again.
            </p>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            {link ? "Done" : "Cancel"}
          </Button>
          {!link && (
            <Button variant="neutral" isPending={createLink.isPending} onClick={issue}>
              Create link
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
