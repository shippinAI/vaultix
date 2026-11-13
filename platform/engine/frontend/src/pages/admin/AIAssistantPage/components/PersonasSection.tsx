import { useState } from "react";

import { createNotification } from "@app/components/notifications";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@app/components/v3";
import {
  TAssistantPersona,
  TAssistantProvider,
  useDeleteAssistantPersona,
  useGetAssistantPersonas,
  useGetAssistantProviders,
  useResetAssistantPersona,
  useUpdateAssistantPersona
} from "@app/hooks/api/assistant";

import { PersonaDialog } from "./PersonaDialog";

const ROLE_LABEL = { router: "Router", specialist: "Specialist", guard: "Guard" } as const;

const PersonaRow = ({
  persona,
  providers,
  onEdit
}: {
  persona: TAssistantPersona;
  providers: TAssistantProvider[];
  onEdit: () => void;
}) => {
  const updatePersona = useUpdateAssistantPersona();
  const resetPersona = useResetAssistantPersona();
  const deletePersona = useDeleteAssistantPersona();
  const provider = providers.find((entry) => entry.id === persona.providerId);

  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col">
          <span className="font-medium">
            {persona.name} <span className="font-mono text-xs text-muted">@{persona.slug}</span>
          </span>
          <span className="text-xs text-muted">{persona.description}</span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          <Badge variant={persona.role === "guard" ? "warning" : "neutral"}>
            {ROLE_LABEL[persona.role]}
          </Badge>
          {persona.builtIn ? (
            <Badge variant="outline">{persona.customized ? "Default, changed" : "Default"}</Badge>
          ) : (
            <Badge variant="info">Custom</Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="text-xs">{persona.domains.join(", ")}</TableCell>
      <TableCell className="text-xs">{provider ? provider.name : "Provider in use"}</TableCell>
      <TableCell>
        <Switch
          aria-label={`Turn ${persona.name} on or off`}
          variant="neutral"
          checked={persona.enabled}
          disabled={persona.role === "router" || updatePersona.isPending}
          onCheckedChange={(enabled) =>
            updatePersona.mutate(
              { slug: persona.slug, enabled },
              {
                onSuccess: () =>
                  createNotification({
                    type: "success",
                    text: enabled
                      ? `${persona.name} is on.`
                      : `${persona.name} is off and will not answer.`
                  })
              }
            )
          }
        />
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-2">
          <Button size="xs" variant="ghost" onClick={onEdit}>
            Edit
          </Button>
          {persona.builtIn && persona.customized && (
            <Button
              size="xs"
              variant="ghost"
              isPending={resetPersona.isPending}
              onClick={() =>
                resetPersona.mutate(persona.slug, {
                  onSuccess: () =>
                    createNotification({
                      type: "success",
                      text: `${persona.name} is back to the shipped default.`
                    })
                })
              }
            >
              Reset
            </Button>
          )}
          {!persona.builtIn && (
            <Button
              size="xs"
              variant="ghost"
              isPending={deletePersona.isPending}
              onClick={() =>
                deletePersona.mutate(persona.slug, {
                  onSuccess: () =>
                    createNotification({ type: "success", text: `Removed ${persona.name}.` })
                })
              }
            >
              Remove
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
};

export const PersonasSection = () => {
  const { data } = useGetAssistantPersonas();
  const { data: providerData } = useGetAssistantProviders();
  const [editing, setEditing] = useState<TAssistantPersona | undefined>();
  const [isOpen, setIsOpen] = useState(false);
  const providers = providerData?.providers ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Personas and specialists</CardTitle>
          <CardDescription>
            Clyffy greets people and hands each question to the specialist for that area, using the
            page they are on or an @mention. The guard reviews proposed changes for risk. Defaults
            ship in platform/engine/ai/personas and can be changed, turned off or reset here.
          </CardDescription>
        </div>
        <Button
          variant="neutral"
          onClick={() => {
            setEditing(undefined);
            setIsOpen(true);
          }}
        >
          Add persona
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Persona</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Areas</TableHead>
              <TableHead>Runs on</TableHead>
              <TableHead>On</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.personas ?? []).map((persona) => (
              <PersonaRow
                key={persona.slug}
                persona={persona}
                providers={providers}
                onEdit={() => {
                  setEditing(persona);
                  setIsOpen(true);
                }}
              />
            ))}
          </TableBody>
        </Table>
      </CardContent>
      <PersonaDialog
        persona={editing}
        domains={data?.domains ?? []}
        providers={providers}
        isOpen={isOpen}
        onOpenChange={setIsOpen}
      />
    </Card>
  );
};
