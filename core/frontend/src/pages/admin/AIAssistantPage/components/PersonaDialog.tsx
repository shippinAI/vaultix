import { Controller, useForm } from "react-hook-form";

import { createNotification } from "@app/components/notifications";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TextArea
} from "@app/components/v3";
import {
  TAssistantPersona,
  TAssistantPersonaRole,
  TAssistantPersonaTier,
  TAssistantProvider,
  useCreateAssistantPersona,
  useUpdateAssistantPersona
} from "@app/hooks/api/assistant";

const ACTIVE_PROVIDER = "__active__";

type FormValues = {
  slug: string;
  name: string;
  role: TAssistantPersonaRole;
  tier: TAssistantPersonaTier;
  domains: string[];
  description: string;
  instructions: string;
  providerId: string;
};

type Props = {
  persona?: TAssistantPersona;
  domains: string[];
  providers: TAssistantProvider[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

export const PersonaDialog = ({ persona, domains, providers, isOpen, onOpenChange }: Props) => {
  const createPersona = useCreateAssistantPersona();
  const updatePersona = useUpdateAssistantPersona();
  const editing = Boolean(persona);
  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting }
  } = useForm<FormValues>({
    values: {
      slug: persona?.slug ?? "",
      name: persona?.name ?? "",
      role: persona?.role ?? "specialist",
      tier: persona?.tier ?? "standard",
      domains: persona?.domains ?? [],
      description: persona?.description ?? "",
      instructions: persona?.instructions ?? "",
      providerId: persona?.providerId ?? ACTIVE_PROVIDER
    }
  });

  const close = () => {
    reset();
    onOpenChange(false);
  };

  const onSubmit = async (values: FormValues) => {
    const provider =
      values.providerId === ACTIVE_PROVIDER
        ? { clearProvider: true }
        : { providerId: values.providerId };
    const input = {
      name: values.name,
      tier: values.tier,
      domains: values.domains,
      description: values.description,
      instructions: values.instructions,
      ...provider
    };
    try {
      if (persona) {
        await updatePersona.mutateAsync({ slug: persona.slug, ...input });
        createNotification({ type: "success", text: `Saved ${values.name}.` });
      } else {
        await createPersona.mutateAsync({ slug: values.slug, role: values.role, ...input });
        createNotification({ type: "success", text: `Added ${values.name}.` });
      }
      close();
    } catch {
      // The shared mutation handler shows the server's reason; the form stays open.
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => (open ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? `Edit ${persona?.name}` : "Add a specialist or guard"}
          </DialogTitle>
          <DialogDescription>
            A persona shapes how the assistant answers and which areas&apos; tools it uses. It never
            grants anything: tools always run with the signed-in person&apos;s own permissions.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          {!editing && (
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="ai-persona-slug">Short name</FieldLabel>
                <Input id="ai-persona-slug" placeholder="billing" {...register("slug")} />
                <FieldDescription>People can call it with @short-name.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="ai-persona-role">Role</FieldLabel>
                <Controller
                  control={control}
                  name="role"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="ai-persona-role" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="specialist">
                          Specialist: answers for its areas
                        </SelectItem>
                        <SelectItem value="guard">Guard: reviews changes for risk</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
            </div>
          )}
          <Field>
            <FieldLabel htmlFor="ai-persona-name">Name</FieldLabel>
            <Input id="ai-persona-name" {...register("name")} />
          </Field>
          <Field>
            <FieldLabel htmlFor="ai-persona-description">What it is for</FieldLabel>
            <Input id="ai-persona-description" {...register("description")} />
            <FieldDescription>Clyffy reads this to decide who answers.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel>Areas</FieldLabel>
            <Controller
              control={control}
              name="domains"
              render={({ field }) => (
                <div className="grid grid-cols-3 gap-2">
                  {domains.map((domain) => (
                    <label
                      key={domain}
                      className="flex items-center gap-2 text-sm"
                      htmlFor={`ai-persona-domain-${domain}`}
                    >
                      <Checkbox
                        id={`ai-persona-domain-${domain}`}
                        isChecked={field.value.includes(domain)}
                        onCheckedChange={(checked) =>
                          field.onChange(
                            checked
                              ? [...field.value, domain]
                              : field.value.filter((d) => d !== domain)
                          )
                        }
                      />
                      {domain}
                    </label>
                  ))}
                </div>
              )}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="ai-persona-provider">Runs on</FieldLabel>
              <Controller
                control={control}
                name="providerId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="ai-persona-provider" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ACTIVE_PROVIDER}>The provider in use</SelectItem>
                      {providers.map((provider) => (
                        <SelectItem key={provider.id} value={provider.id}>
                          {provider.name} ({provider.model})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="ai-persona-tier">Model size hint</FieldLabel>
              <Controller
                control={control}
                name="tier"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="ai-persona-tier" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fast">Fast</SelectItem>
                      <SelectItem value="standard">Standard</SelectItem>
                      <SelectItem value="deep">Deep</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="ai-persona-instructions">Instructions</FieldLabel>
            <TextArea id="ai-persona-instructions" rows={8} {...register("instructions")} />
            <FieldDescription>
              Vaultix&apos;s standing rules always come first: tools run as the person, and values
              are never seen or asked for.
            </FieldDescription>
          </Field>
          <DialogFooter>
            <Button variant="ghost" type="button" onClick={close}>
              Cancel
            </Button>
            <Button variant="neutral" type="submit" isPending={isSubmitting}>
              {editing ? "Save" : "Add persona"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
