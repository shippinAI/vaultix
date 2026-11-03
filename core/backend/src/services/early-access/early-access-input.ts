import { BadRequestError } from "@app/lib/errors";
import { sanitizeEmail, validateEmail } from "@app/lib/validator/validate-email";

import {
  EARLY_ACCESS_STATUSES,
  TEarlyAccessBulkDeleteFilter,
  TEarlyAccessListFilter,
  TEarlyAccessStatus,
  TEarlyAccessSubmission
} from "./early-access-types";

const MAX_EMAIL_LENGTH = 254;
const MAX_LOCAL_PART_LENGTH = 64;
const MAX_NAME_LENGTH = 128;
const MAX_ORGANIZATION_NAME_LENGTH = 64;
const MAX_USE_CASE_LENGTH = 1000;
const MAX_SEARCH_LENGTH = 128;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;
const SUBMISSION_FIELDS = new Set(["email", "name", "organization", "useCase", "website"]);

// Postgres rejects NUL outright, and the rest have no place in a contact form. That includes the
// directional overrides and isolates, which make text read differently in the console than it is.
// Joiners stay, because names and emoji need them.
// eslint-disable-next-line no-control-regex
const SINGLE_LINE_CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
// eslint-disable-next-line no-control-regex
const MULTI_LINE_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
// The form of address the existing organization route accepts. This one becomes a username, and
// anything looser can look like another address in the console or evade the duplicate check.
const EMAIL_FORM = /^(?!\.)(?!.*\.\.)[a-z0-9_'+.-]*[a-z0-9_+-]@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

const asRecord = (value: unknown, message: string) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestError({ message });
  return value as Record<string, unknown>;
};

const optionalText = (value: unknown, label: string, maxLength: number, control = SINGLE_LINE_CONTROL) => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new BadRequestError({ message: `${label} must be text.` });
  const text = value.trim();
  if (text.length > maxLength)
    throw new BadRequestError({ message: `${label} must be ${maxLength} characters or fewer.` });
  if (control.test(text)) throw new BadRequestError({ message: `${label} contains characters that are not allowed.` });
  return text || null;
};

const parseEmail = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) throw new BadRequestError({ message: "Enter your email address." });
  const email = sanitizeEmail(value);
  const invalid = new BadRequestError({ message: "Enter a valid email address." });
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_FORM.test(email)) throw invalid;
  if (email.indexOf("@") > MAX_LOCAL_PART_LENGTH) throw invalid;
  try {
    validateEmail(email);
  } catch {
    throw invalid;
  }
  return email;
};

// Returns null for the hidden field that only automated submitters fill in. The caller answers
// them as it answers everyone, so the response does not teach them to stop filling it.
export const parseEarlyAccessSubmission = (body: unknown): TEarlyAccessSubmission | null => {
  const input = asRecord(body, "Send the request as a JSON object.");
  if (Object.keys(input).some((key) => !SUBMISSION_FIELDS.has(key)))
    throw new BadRequestError({ message: "The request contains an unknown field." });
  if (input.website) return null;
  return {
    email: parseEmail(input.email),
    name: optionalText(input.name, "Name", MAX_NAME_LENGTH),
    organization: optionalText(input.organization, "Organization", MAX_NAME_LENGTH),
    useCase: optionalText(input.useCase, "Your note", MAX_USE_CASE_LENGTH, MULTI_LINE_CONTROL)
  };
};

const parseBoundedInteger = (value: unknown, label: string, fallback: number, max: number) => {
  if (value === undefined) return fallback;
  const parsed = typeof value === "string" && /^\d{1,9}$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed > max) throw new BadRequestError({ message: `Invalid ${label}.` });
  return parsed;
};

export const parseEarlyAccessListQuery = (query: unknown): TEarlyAccessListFilter => {
  const input = asRecord(query, "Invalid query.");
  const { status, search } = input;
  if (status !== undefined && !EARLY_ACCESS_STATUSES.includes(status as TEarlyAccessStatus))
    throw new BadRequestError({ message: "Invalid status." });
  return {
    status: status as TEarlyAccessStatus | undefined,
    search: optionalText(search, "Search", MAX_SEARCH_LENGTH) ?? undefined,
    limit: parseBoundedInteger(input.limit, "limit", DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE) || DEFAULT_PAGE_SIZE,
    offset: parseBoundedInteger(input.offset, "offset", 0, 1_000_000)
  };
};

export const parseEarlyAccessRequestId = (params: unknown) => {
  const { requestId } = asRecord(params, "Invalid request.");
  if (
    typeof requestId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)
  )
    throw new BadRequestError({ message: "Invalid request." });
  return requestId;
};

// The rule the existing organization route applies to a name.
export const parseEarlyAccessInvite = (body: unknown) => {
  const { organizationName } = asRecord(body, "Send the invitation as a JSON object.");
  const name = typeof organizationName === "string" ? organizationName.trim() : "";
  if (!name) throw new BadRequestError({ message: "Name must be at least 1 character" });
  if (name.length > MAX_ORGANIZATION_NAME_LENGTH)
    throw new BadRequestError({ message: `Name must be ${MAX_ORGANIZATION_NAME_LENGTH} or fewer characters` });
  if (!/^[a-zA-Z0-9_ -]+$/.test(name))
    throw new BadRequestError({
      message: "Name can only contain alphanumeric characters, dashes, underscores, and spaces"
    });
  return { organizationName: name };
};

// Invited requests record a decision, so only the ones still waiting or declined go in bulk.
export const parseEarlyAccessBulkDelete = (body: unknown): TEarlyAccessBulkDeleteFilter => {
  const { status, search } = asRecord(body, "Send the filter as a JSON object.");
  if (status !== "pending" && status !== "declined")
    throw new BadRequestError({ message: "Only pending or declined requests can be deleted together." });
  return { status, search: optionalText(search, "Search", MAX_SEARCH_LENGTH) ?? undefined };
};
