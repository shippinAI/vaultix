import { FormEvent, KeyboardEvent, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AxiosError } from "axios";

import {
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TextArea
} from "@app/components/v3";
import { useUser } from "@app/context";
import {
  TAssistantAction,
  TAssistantMessage,
  TAssistantReply,
  useGetAssistantStatus,
  useSendAssistantMessage
} from "@app/hooks/api/assistant";

import { readSignals } from "./signal-fabric";

const ROUTED = {
  mention: "asked for by name",
  page: "for the page you are on",
  router: "chosen by Clyffy",
  default: "Clyffy"
} as const;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

const AUTO = "__auto__";
const MAX_HISTORY = 40;

type Entry = { id: number } & (
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; reply: TAssistantReply }
  | { role: "error"; content: string }
);

const errorText = (error: unknown) =>
  (error as AxiosError<{ message?: string }>)?.response?.data?.message ??
  "The assistant could not be reached. Nothing was changed.";

const Actions = ({ actions }: { actions: TAssistantAction[] }) =>
  actions.length === 0 ? null : (
    <ul className="mt-2 space-y-1 text-xs text-muted" aria-label="Actions the assistant ran">
      {actions.map((action, index) => (
        // Actions have no identity of their own beyond their order in this answer.
        // eslint-disable-next-line react/no-array-index-key
        <li key={`${action.tool}-${index}`}>
          {action.status === "ran" ? "Ran" : "Refused"}{" "}
          <span className="font-mono">{action.tool}</span>
          {action.error ? `: ${action.error}` : ""}
        </li>
      ))}
    </ul>
  );

export const AssistantChat = () => {
  const status = useGetAssistantStatus();
  const send = useSendAssistantMessage();
  const { user } = useUser();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [persona, setPersona] = useState(AUTO);
  const input = useRef<HTMLTextAreaElement>(null);
  const nextId = useRef(0);
  const append = (entry: DistributiveOmit<Entry, "id">) => {
    nextId.current += 1;
    const id = nextId.current;
    setEntries((current) => [...current, { ...entry, id } as Entry]);
  };

  if (status.isPending) return <p role="status">Checking the assistant…</p>;
  if (status.isError) return <p role="alert">The assistant status is unavailable.</p>;
  if (!status.data.available)
    return (
      <div className="rounded-md border border-border p-3 text-sm">
        <p>{status.data.reason}</p>
        {user.superAdmin && (
          <Link to="/admin/ai-assistant" className="mt-2 inline-block underline">
            Set up the assistant
          </Link>
        )}
      </div>
    );

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const content = draft.trim();
    if (!content || send.isPending) return;
    const history: TAssistantMessage[] = entries
      .filter((entry): entry is Exclude<Entry, { role: "error" }> => entry.role !== "error")
      .map((entry) => ({ role: entry.role, content: entry.content }));
    const messages = [...history, { role: "user" as const, content }].slice(-MAX_HISTORY);
    append({ role: "user", content });
    setDraft("");
    try {
      const reply = await send.mutateAsync({
        messages,
        signals: readSignals(),
        persona: persona === AUTO ? undefined : persona
      });
      append({ role: "assistant", content: reply.message.content, reply });
    } catch (error) {
      append({ role: "error", content: errorText(error) });
    }
    input.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <section aria-label="Ask the Vaultix assistant" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Ask</h3>
        <Select value={persona} onValueChange={setPersona}>
          <SelectTrigger aria-label="Who answers" className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={AUTO}>Let Clyffy choose</SelectItem>
            {status.data.personas.map((entry) => (
              <SelectItem key={entry.slug} value={entry.slug}>
                {entry.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div role="log" aria-live="polite" className="max-h-96 space-y-3 overflow-y-auto">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className={
              entry.role === "user" ? "ml-8 rounded-md bg-foreground/5 p-2 text-sm" : "mr-8 text-sm"
            }
          >
            {entry.role === "assistant" && (
              <div className="mb-1 flex items-center gap-2">
                <Badge variant={entry.reply.persona.role === "router" ? "neutral" : "info"}>
                  {entry.reply.persona.name}
                </Badge>
                <span className="text-xs text-muted">{ROUTED[entry.reply.routedBy]}</span>
              </div>
            )}
            {entry.role === "error" ? (
              <p role="alert" className="text-danger">
                {entry.content}
              </p>
            ) : (
              <p className="whitespace-pre-wrap">{entry.content}</p>
            )}
            {entry.role === "assistant" && <Actions actions={entry.reply.actions} />}
          </div>
        ))}
        {send.isPending && (
          <p role="status" className="text-xs text-muted">
            Thinking…
          </p>
        )}
      </div>
      <form onSubmit={submit} className="space-y-2">
        <TextArea
          ref={input}
          aria-label="Message"
          rows={3}
          value={draft}
          maxLength={8000}
          placeholder="Ask about your projects, secrets or access. Type @ and a name to ask a specialist."
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted">
            Never paste a secret value here. Runs on {status.data.provider?.name} with your
            permissions.
          </p>
          <Button
            type="submit"
            variant="neutral"
            isPending={send.isPending}
            isDisabled={!draft.trim()}
          >
            Send
          </Button>
        </div>
      </form>
    </section>
  );
};
