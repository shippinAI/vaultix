import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightIcon, CheckIcon } from "lucide-react";

import { Button } from "@app/components/v3/generic/Button/Button";
import { Field, FieldError, FieldLabel } from "@app/components/v3/generic/Field/Field";
import { Input } from "@app/components/v3/generic/Input/Input";
import { TextArea } from "@app/components/v3/generic/TextArea/TextArea";

type EarlyAccessForm = {
  email: string;
  name: string;
  organization: string;
  useCase: string;
  website: string;
};

const FAILURE = "Your request could not be sent. Please try again in a moment.";

// The public page stays outside the session layer: no auth header, token refresh or redirect.
const fetchAcceptingRequests = async () => {
  const response = await fetch("/api/v1/early-access/status", { credentials: "omit" });
  if (!response.ok) throw new Error("Early access status is unavailable");
  const { acceptingRequests } = (await response.json()) as { acceptingRequests?: unknown };
  return acceptingRequests === true;
};

// The landing page never waits on this. Any failure leaves it as it is without the form.
export const useEarlyAccessAvailability = () =>
  useQuery({
    queryKey: ["early-access-status"],
    queryFn: fetchAcceptingRequests,
    retry: false,
    staleTime: 60_000
  }).data === true;

export const EarlyAccessSection = () => {
  const [submitted, setSubmitted] = useState(false);
  const [failure, setFailure] = useState<string>();
  const confirmation = useRef<HTMLHeadingElement>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<EarlyAccessForm>({
    defaultValues: { email: "", name: "", organization: "", useCase: "", website: "" }
  });

  useEffect(() => {
    if (submitted) confirmation.current?.focus();
  }, [submitted]);

  const onSubmit = async (values: EarlyAccessForm) => {
    setFailure(undefined);
    try {
      const response = await fetch("/api/v1/early-access/requests", {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values)
      });
      if (response.ok) {
        setSubmitted(true);
        return;
      }
      const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
      setFailure(typeof body?.message === "string" ? body.message : FAILURE);
    } catch {
      setFailure(FAILURE);
    }
  };

  return (
    <section
      id="early-access"
      className="public-container public-section public-early-access"
      aria-labelledby="early-access-heading"
    >
      <div className="public-early-access-copy">
        <p className="public-eyebrow">INVITE-ONLY FOR NOW</p>
        <h2 id="early-access-heading">
          Want in early?
          <br />
          <span>Tell us what you&apos;re building.</span>
        </h2>
        <p>
          Vaultix is opening a few seats at a time. Leave your details and an administrator will
          review your request.
        </p>
      </div>
      <div className="public-early-access-card">
        {submitted ? (
          <div className="public-early-access-done" role="status">
            <h3 ref={confirmation} tabIndex={-1}>
              <CheckIcon aria-hidden="true" />
              Thanks. We&apos;ve got your request.
            </h3>
            <p>
              An administrator will review it and contact you at the address you gave if there is a
              place for you.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} noValidate aria-label="Request early access">
            <Field>
              <FieldLabel htmlFor="early-access-email">Email</FieldLabel>
              <Input
                id="early-access-email"
                type="email"
                autoComplete="email"
                aria-required="true"
                aria-describedby={errors.email ? "early-access-email-error" : undefined}
                isError={Boolean(errors.email)}
                {...register("email", {
                  required: "Enter your email address.",
                  maxLength: {
                    value: 254,
                    message: "Use an email address of 254 characters or fewer."
                  },
                  pattern: {
                    value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                    message: "Enter a valid email address."
                  }
                })}
              />
              <FieldError id="early-access-email-error">{errors.email?.message}</FieldError>
            </Field>
            <div className="public-early-access-pair">
              <Field>
                <FieldLabel htmlFor="early-access-name">Name (optional)</FieldLabel>
                <Input
                  id="early-access-name"
                  autoComplete="name"
                  aria-describedby={errors.name ? "early-access-name-error" : undefined}
                  isError={Boolean(errors.name)}
                  {...register("name", {
                    maxLength: { value: 128, message: "Use 128 characters or fewer." }
                  })}
                />
                <FieldError id="early-access-name-error">{errors.name?.message}</FieldError>
              </Field>
              <Field>
                <FieldLabel htmlFor="early-access-organization">Organization (optional)</FieldLabel>
                <Input
                  id="early-access-organization"
                  autoComplete="organization"
                  aria-describedby={
                    errors.organization ? "early-access-organization-error" : undefined
                  }
                  isError={Boolean(errors.organization)}
                  {...register("organization", {
                    maxLength: { value: 128, message: "Use 128 characters or fewer." }
                  })}
                />
                <FieldError id="early-access-organization-error">
                  {errors.organization?.message}
                </FieldError>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="early-access-use-case">
                What would you use Vaultix for? (optional)
              </FieldLabel>
              <TextArea
                id="early-access-use-case"
                rows={3}
                aria-describedby={errors.useCase ? "early-access-use-case-error" : undefined}
                isError={Boolean(errors.useCase)}
                {...register("useCase", {
                  maxLength: { value: 1000, message: "Use 1000 characters or fewer." }
                })}
              />
              <FieldError id="early-access-use-case-error">{errors.useCase?.message}</FieldError>
            </Field>
            <div className="public-early-access-trap" aria-hidden="true">
              <label htmlFor="early-access-website">
                Website
                <input
                  id="early-access-website"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  {...register("website")}
                />
              </label>
            </div>
            {failure && <p role="alert">{failure}</p>}
            <Button type="submit" variant="project" size="lg" isPending={isSubmitting}>
              Request early access <ArrowRightIcon />
            </Button>
            <p className="public-early-access-notice">
              The administrators of this Vaultix instance review each request. Your details are used
              only to reply to it.
            </p>
          </form>
        )}
      </div>
    </section>
  );
};
