import { logger } from "@app/lib/logger";

export type TOrganizationInvitation =
  | { email: string; delivery: "email" }
  | { email: string; delivery: "link"; link: string }
  | { email: string; delivery: "failed" };

// Mail errors quote their recipients, so only the kind of failure reaches the logs.
const failureKind = (error: unknown) => ({
  name: (error as Error)?.name,
  code: (error as { code?: unknown })?.code
});

// Mail is best effort after the organization commits. Without working SMTP the only way to
// reach the invitee is the link itself, so it goes back to the administrator who asked.
export const deliverOrganizationInvitation = async ({
  email,
  isSmtpConfigured,
  createLink,
  sendMail
}: {
  email: string;
  isSmtpConfigured: boolean;
  createLink: () => Promise<string>;
  sendMail: (link: string) => Promise<unknown>;
}): Promise<TOrganizationInvitation> => {
  let link: string;
  try {
    link = await createLink();
  } catch (error) {
    logger.error(failureKind(error), "Failed to create organization invitation");
    return { email, delivery: "failed" };
  }
  try {
    await sendMail(link);
    if (isSmtpConfigured) return { email, delivery: "email" };
  } catch (error) {
    logger.error(failureKind(error), "Failed to send organization invitation");
  }
  return { email, delivery: "link", link };
};
