type WorkspaceStep = {
  id: string;
  title: string;
  description: string;
};

type WorkspaceEntry = {
  id: string;
  title: string;
  description: string;
};

export const VaultixWorkspaceSetupCard = ({ steps }: { steps: WorkspaceStep[] }) => {
  return (
    <section
      aria-labelledby="vaultix-setup-heading"
      className="rounded-md border border-border bg-card p-5 text-foreground"
    >
      <header>
        <h2 id="vaultix-setup-heading" className="text-lg font-semibold">
          Your First App, Connected
        </h2>
        <p className="mt-2 text-sm text-muted">
          A clear path from a new app to secrets it can use.
        </p>
      </header>
      <ol className="mt-5 grid gap-6 md:grid-cols-2">
        {steps.map((step, index) => (
          <li key={step.id} className="flex gap-3">
            <span
              aria-hidden="true"
              className="flex size-7 shrink-0 items-center justify-center rounded border border-project/30 bg-project/5 text-sm text-project"
            >
              {index + 1}
            </span>
            <div>
              <p className="sr-only">Step {index + 1}</p>
              <h3 className="font-medium">{step.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted">{step.description}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
};

export const VaultixPrinciplesCards = ({ entries }: { entries: WorkspaceEntry[] }) => {
  return (
    <section aria-label="Vaultix principles" className="grid gap-4 sm:grid-cols-2">
      {entries.map((entry) => {
        const headingId = `vaultix-principle-${entry.id}`;
        return (
          <article
            key={entry.id}
            aria-labelledby={headingId}
            className="rounded-md border border-border bg-card p-5 text-foreground"
          >
            <h2 id={headingId} className="text-base font-semibold">
              {entry.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{entry.description}</p>
          </article>
        );
      })}
    </section>
  );
};
