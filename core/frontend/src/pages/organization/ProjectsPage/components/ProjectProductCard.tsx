import { LucideIcon } from "lucide-react";

import { Button } from "@app/components/v3";
import { cn } from "@app/components/v3/utils";
import { vaultixActionTrigger } from "@app/components/vaultix/action-trigger";

type ProductStat = {
  label: string;
  value: string;
};

type ProjectProductCardProps = {
  cardId: string;
  title: string;
  description: string;
  icon: LucideIcon;
  iconClassName: string;
  iconContainerClassName: string;
  titleUnderlineClassName: string;
  stats: ProductStat[];
  actionId: string;
  actionLabel: string;
  actionHint?: string;
  isActionDisabled: boolean;
  disabledReason?: string;
  onAction: () => void;
  className?: string;
};

export const ProjectProductCard = ({
  cardId,
  title,
  description,
  icon: Icon,
  iconClassName,
  iconContainerClassName,
  titleUnderlineClassName,
  stats,
  actionId,
  actionLabel,
  actionHint,
  isActionDisabled,
  disabledReason,
  onAction,
  className
}: ProjectProductCardProps) => {
  const headingId = `${cardId}-heading`;
  const descriptionId = `${cardId}-description`;
  const statusId = `${cardId}-status`;
  const actionDescriptionId = isActionDisabled ? statusId : descriptionId;
  const cardToneClass = isActionDisabled
    ? "border-border bg-card"
    : "border-border bg-card transition-colors hover:bg-container-hover";

  return (
    <article
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
      className={cn(
        "flex min-h-full min-w-0 flex-col rounded-md border p-5 text-foreground",
        cardToneClass,
        className
      )}
    >
      <div className="flex items-start gap-3">
        <div
          aria-hidden="true"
          className={cn(
            "shrink-0 rounded-sm border p-1.5 transition-colors duration-200",
            iconContainerClassName
          )}
        >
          <Icon className={iconClassName} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className="text-base font-semibold text-foreground">
            <span
              className={cn(
                "underline decoration-[1.5px] underline-offset-4",
                titleUnderlineClassName
              )}
            >
              {title}
            </span>
          </h3>
          <p id={descriptionId} className="mt-1 text-sm leading-relaxed text-muted">
            {description}
          </p>
        </div>
      </div>

      {stats.length > 0 && (
        <dl className="mt-4 flex flex-wrap items-center gap-4 border-t border-border pt-3">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="flex flex-col border-r border-border pr-4 last:border-r-0 last:pr-0"
            >
              <dt className="order-2 text-xs text-muted">{stat.label}</dt>
              <dd className="text-sm font-medium text-foreground">{stat.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-auto flex flex-col gap-2 border-t border-border pt-4">
        <Button
          type="button"
          variant="outline"
          className="self-start"
          aria-disabled={isActionDisabled}
          aria-describedby={actionDescriptionId}
          onClick={() => {
            if (!isActionDisabled) onAction();
          }}
          {...vaultixActionTrigger(actionId, { scope: "organization-projects", target: cardId })}
        >
          {actionLabel}
        </Button>
        {isActionDisabled ? (
          <p id={statusId} className="text-sm text-muted">
            {disabledReason}
          </p>
        ) : (
          actionHint && <p className="text-xs text-muted">{actionHint}</p>
        )}
      </div>
    </article>
  );
};
