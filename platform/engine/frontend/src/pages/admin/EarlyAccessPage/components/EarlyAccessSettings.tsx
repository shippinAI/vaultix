import { Link } from "@tanstack/react-router";

import { createNotification } from "@app/components/notifications";
import {
  Card,
  CardContent,
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  Switch
} from "@app/components/v3";
import { useServerConfig } from "@app/context";
import { useUpdateServerConfig } from "@app/hooks/api";

export const EarlyAccessSettings = () => {
  const { config } = useServerConfig();
  const { mutate: updateServerConfig, isPending } = useUpdateServerConfig();

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="early-access-enabled">Accept early access requests</FieldLabel>
            <FieldDescription>
              Shows a request form on the public landing page. Requests wait here for you to review.
              Nobody gets access until you invite them.
            </FieldDescription>
          </FieldContent>
          <Switch
            id="early-access-enabled"
            variant="neutral"
            checked={Boolean(config.earlyAccessRequestsEnabled)}
            disabled={isPending}
            onCheckedChange={(earlyAccessRequestsEnabled) =>
              updateServerConfig(
                { earlyAccessRequestsEnabled },
                {
                  onSuccess: () =>
                    createNotification({
                      type: "success",
                      text: earlyAccessRequestsEnabled
                        ? "The early access form is now on the landing page."
                        : "The early access form has been removed from the landing page."
                    })
                }
              )
            }
          />
        </Field>
        {config.allowSignUp && (
          <p className="text-sm text-muted">
            Signup is open on this instance, so people can create accounts without asking.{" "}
            <Link to="/admin" className="underline">
              Close signup in General settings
            </Link>{" "}
            to make requests the way in.
          </p>
        )}
      </CardContent>
    </Card>
  );
};
