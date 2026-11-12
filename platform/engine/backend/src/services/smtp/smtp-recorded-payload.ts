import { domainToASCII } from "node:url";

export type PreparedRecordedMail = {
  version: 1;
  recipient: string;
  from: { name: string; address: string };
  subject: string;
  html: string;
  createdAt: string;
};

export class RecordedMailError extends Error {
  constructor(readonly disposition: "invalid" | "retryable" | "uncertain") {
    const messages = {
      invalid: "Invalid prepared security mail",
      retryable: "Security mail was not accepted; delivery may be retried",
      uncertain: "Security mail acceptance is unknown; review before retrying"
    };
    super(messages[disposition]);
    this.name = "RecordedMailError";
  }
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const header = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max && !/[\p{Cc}]/u.test(value);

export const isRecordedMailbox = (value: unknown): value is string =>
  header(value, 320) && /^[^\s,;<>@()"\\]+@[^\s,;<>@()"\\]+$/u.test(value);

export const recordedMailboxMatches = (expected: string, actual: unknown): boolean => {
  const canonical = (value: unknown) => {
    if (!isRecordedMailbox(value)) return null;
    const at = value.indexOf("@");
    const domain = domainToASCII(value.slice(at + 1));
    return domain ? `${value.slice(0, at)}@${domain.toLowerCase()}` : null;
  };
  const mailbox = canonical(expected);
  return mailbox !== null && mailbox === canonical(actual);
};

export const parsePreparedRecordedMail = (value: unknown): PreparedRecordedMail => {
  if (
    !record(value) ||
    !exactKeys(value, ["version", "recipient", "from", "subject", "html", "createdAt"]) ||
    value.version !== 1 ||
    !isRecordedMailbox(value.recipient) ||
    !record(value.from) ||
    !exactKeys(value.from, ["name", "address"]) ||
    !header(value.from.name, 255) ||
    !isRecordedMailbox(value.from.address) ||
    !header(value.subject, 255) ||
    !value.subject.trim() ||
    typeof value.html !== "string" ||
    !value.html ||
    value.html.length > 49152 ||
    typeof value.createdAt !== "string" ||
    value.createdAt.length !== 24 ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    new Date(value.createdAt).toISOString() !== value.createdAt
  ) {
    throw new RecordedMailError("invalid");
  }
  const result: PreparedRecordedMail = {
    version: 1,
    recipient: value.recipient,
    from: { name: value.from.name, address: value.from.address },
    subject: value.subject,
    html: value.html,
    createdAt: value.createdAt
  };
  if (Buffer.byteLength(JSON.stringify(result)) > 60000) throw new RecordedMailError("invalid");
  return result;
};

export const classifyRecordedMailFailure = (error: unknown): RecordedMailError => {
  if (!record(error)) return new RecordedMailError("uncertain");
  // A closed socket does not tell us whether the server accepted DATA. Only
  // a known pre-message phase or explicit negative DATA reply permits a retry.
  // Nodemailer 8 also labels post-DATA socket failures CONN, so that command
  // alone is not evidence that the connection failed before sending.
  const beforeData =
    (error.command === "CONN" && error.code === "EDNS") ||
    (typeof error.command === "string" &&
      /^(EHLO|HELO|STARTTLS|AUTH(?: [A-Z0-9_-]+)?|MAIL FROM|RCPT TO)$/u.test(error.command));
  const rejectedData =
    error.command === "DATA" &&
    typeof error.responseCode === "number" &&
    Number.isInteger(error.responseCode) &&
    error.responseCode >= 400 &&
    error.responseCode <= 599;
  return new RecordedMailError(beforeData || rejectedData ? "retryable" : "uncertain");
};
