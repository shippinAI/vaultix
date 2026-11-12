import { FormEvent, useState } from "react";

import { createNotification } from "@app/components/notifications";
import {
  Badge,
  Button,
  Field,
  FieldDescription,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TextArea
} from "@app/components/v3";
import {
  TAssistantMemory,
  TAssistantMemoryScope,
  useCreateAssistantMemory,
  useDeleteAssistantMemory,
  useGetAssistantMemories,
  useUpdateAssistantMemory
} from "@app/hooks/api/assistant";

const EVERY_PERSONA = "__every__";
const MAX_MEMORY = 1000;

type PersonaChoice = { slug: string; name: string };

type Props = {
  // The scope this list adds to. Personal lists also show instance memories, read-only.
  scope: TAssistantMemoryScope;
  personas: PersonaChoice[];
};

const PersonaSelect = ({
  id,
  value,
  personas,
  onChange
}: {
  id: string;
  value: string;
  personas: PersonaChoice[];
  onChange: (value: string) => void;
}) => (
  <Select
    value={value || EVERY_PERSONA}
    onValueChange={(v) => onChange(v === EVERY_PERSONA ? "" : v)}
  >
    <SelectTrigger id={id} className="w-full">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value={EVERY_PERSONA}>Every persona</SelectItem>
      {personas.map((persona) => (
        <SelectItem key={persona.slug} value={persona.slug}>
          {persona.name}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

const MemoryRow = ({
  memory,
  editable,
  personas
}: {
  memory: TAssistantMemory;
  editable: boolean;
  personas: PersonaChoice[];
}) => {
  const update = useUpdateAssistantMemory();
  const remove = useDeleteAssistantMemory();
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(memory.content);
  const [persona, setPersona] = useState(memory.persona);
  const personaName = personas.find((p) => p.slug === memory.persona)?.name ?? memory.persona;

  const save = async () => {
    try {
      await update.mutateAsync({ id: memory.id, content, persona });
      setEditing(false);
    } catch {
      // The shared mutation handler shows why; the editor stays open.
    }
  };

  if (editing)
    return (
      <li className="space-y-2 rounded-md border border-border p-2">
        <TextArea
          aria-label="Memory"
          rows={2}
          value={content}
          maxLength={MAX_MEMORY}
          onChange={(event) => setContent(event.target.value)}
        />
        <PersonaSelect
          id={`memory-persona-${memory.id}`}
          value={persona}
          personas={personas}
          onChange={setPersona}
        />
        <div className="flex justify-end gap-2">
          <Button size="xs" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <Button
            size="xs"
            variant="neutral"
            isPending={update.isPending}
            isDisabled={!content.trim()}
            onClick={save}
          >
            Save
          </Button>
        </div>
      </li>
    );

  return (
    <li className="flex items-start justify-between gap-2 rounded-md border border-border p-2 text-sm">
      <div className="min-w-0 space-y-1">
        <p className="break-words whitespace-pre-wrap">{memory.content}</p>
        <div className="flex flex-wrap gap-1">
          <Badge variant={memory.scope === "instance" ? "info" : "neutral"}>
            {memory.scope === "instance" ? "Everyone" : "Only you"}
          </Badge>
          {memory.persona && <Badge variant="neutral">{personaName}</Badge>}
          {memory.source === "assistant" && <Badge variant="neutral">Suggested</Badge>}
        </div>
      </div>
      {editable && (
        <div className="flex shrink-0 gap-1">
          <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button
            size="xs"
            variant="ghost"
            isPending={remove.isPending}
            onClick={() =>
              remove.mutate(memory.id, {
                onSuccess: () => createNotification({ type: "success", text: "Forgotten." })
              })
            }
          >
            Forget
          </Button>
        </div>
      )}
    </li>
  );
};

export const AssistantMemories = ({ scope, personas }: Props) => {
  const { data, isPending, isError } = useGetAssistantMemories();
  const create = useCreateAssistantMemory();
  const [content, setContent] = useState("");
  const [persona, setPersona] = useState("");

  if (isPending) return <p role="status">Loading memories…</p>;
  if (isError) return <p role="alert">Memories are unavailable.</p>;

  const shown = data.memories.filter((m) => scope === "personal" || m.scope === "instance");
  const canAdd = scope === "personal" || data.canManageInstance;

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!content.trim()) return;
    try {
      await create.mutateAsync({ scope, content, persona: persona || undefined });
      setContent("");
      setPersona("");
    } catch {
      // The shared mutation handler shows why, for example a value that looks like a secret.
    }
  };

  return (
    <div className="space-y-3">
      {shown.length === 0 ? (
        <p className="text-sm text-muted">
          {scope === "personal"
            ? "Nothing remembered yet. Add a note below, or accept one the assistant suggests."
            : "No memories for everyone yet."}
        </p>
      ) : (
        <ul className="space-y-2" aria-label="Memories">
          {shown.map((memory) => (
            <MemoryRow
              key={memory.id}
              memory={memory}
              personas={personas}
              editable={memory.scope === "personal" || data.canManageInstance}
            />
          ))}
        </ul>
      )}
      {canAdd && (
        <form onSubmit={add} className="space-y-2">
          <Field>
            <FieldLabel htmlFor={`memory-new-${scope}`}>
              {scope === "personal" ? "Remember for me" : "Remember for everyone"}
            </FieldLabel>
            <TextArea
              id={`memory-new-${scope}`}
              rows={2}
              value={content}
              maxLength={MAX_MEMORY}
              placeholder={
                scope === "personal"
                  ? "I work in the payments project and deploy to staging first."
                  : "Production changes need an approved change ticket."
              }
              onChange={(event) => setContent(event.target.value)}
            />
            <FieldDescription>
              A note the assistant reads before answering. Never a secret value: anything that looks
              like one is refused.
            </FieldDescription>
          </Field>
          <div className="flex items-end gap-2">
            <Field className="flex-1">
              <FieldLabel htmlFor={`memory-new-persona-${scope}`}>Applies to</FieldLabel>
              <PersonaSelect
                id={`memory-new-persona-${scope}`}
                value={persona}
                personas={personas}
                onChange={setPersona}
              />
            </Field>
            <Button
              type="submit"
              variant="neutral"
              isPending={create.isPending}
              isDisabled={!content.trim()}
            >
              Remember
            </Button>
          </div>
        </form>
      )}
    </div>
  );
};

// A suggestion from one answer. Accepting saves it as the person's own memory.
export const MemoryProposal = ({ content }: { content: string }) => {
  const create = useCreateAssistantMemory();
  const [state, setState] = useState<"open" | "saved" | "dismissed">("open");
  if (state === "dismissed") return null;
  return (
    <div className="mt-2 rounded-md border border-border p-2 text-xs">
      <p className="text-muted">Remember this for next time?</p>
      <p className="my-1 whitespace-pre-wrap">{content}</p>
      {state === "saved" ? (
        <p role="status">Remembered. You can change it under Memories.</p>
      ) : (
        <div className="flex gap-2">
          <Button
            size="xs"
            variant="neutral"
            isPending={create.isPending}
            onClick={() =>
              create.mutate(
                { scope: "personal", content, source: "assistant" },
                { onSuccess: () => setState("saved") }
              )
            }
          >
            Remember
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setState("dismissed")}>
            Dismiss
          </Button>
        </div>
      )}
    </div>
  );
};
