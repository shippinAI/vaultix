import { useId } from "react";
import { Cell, Pie, PieChart, Tooltip as RechartsTooltip } from "recharts";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@app/components/v3/generic/Card";

import { CHART_COLORS } from "./chart-theme";

export type CertificateChartEntry = {
  id: string;
  label: string;
  count: number;
  onSelect?: () => void;
};

type Props = {
  title: string;
  description: string;
  entries: CertificateChartEntry[];
  emptyMessage?: string;
};

export const CertificateDistributionCard = ({
  title,
  description,
  entries,
  emptyMessage = "No data available"
}: Props) => {
  const titleId = useId();
  const chartData = entries.map((entry, index) => ({
    ...entry,
    color: CHART_COLORS[index % CHART_COLORS.length]
  }));
  const nonZeroData = chartData.filter((entry) => entry.count > 0);
  const total = entries.reduce((sum, entry) => sum + entry.count, 0);

  return (
    <Card
      role="region"
      aria-labelledby={titleId}
      data-vaultix-certificate-chart
      className="h-auto min-w-0 flex-[1_1_250px]"
    >
      <CardHeader className="pb-0">
        <CardTitle className="text-base font-semibold">
          <h2 id={titleId}>{title}</h2>
        </CardTitle>
        <CardDescription className="text-xs text-muted">{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 pt-2">
        {nonZeroData.length === 0 ? (
          <p className="flex min-h-40 items-center justify-center rounded-sm bg-container p-4 text-sm text-muted">
            {emptyMessage}
          </p>
        ) : (
          <>
            {/* Every visual value and action has an equivalent readable row below. */}
            <div aria-hidden="true" className="self-center">
              <PieChart width={120} height={120} accessibilityLayer={false}>
                <Pie
                  data={nonZeroData}
                  dataKey="count"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  innerRadius={32}
                  outerRadius={52}
                  paddingAngle={2}
                  stroke="var(--color-card)"
                  isAnimationActive={false}
                  rootTabIndex={-1}
                  onClick={(_entry, index) => nonZeroData[index]?.onSelect?.()}
                >
                  {nonZeroData.map((entry) => (
                    <Cell
                      key={entry.id}
                      fill={entry.color}
                      cursor={entry.onSelect ? "pointer" : "default"}
                    />
                  ))}
                </Pie>
                <RechartsTooltip
                  isAnimationActive={false}
                  contentStyle={{
                    backgroundColor: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "6px",
                    color: "var(--color-foreground)"
                  }}
                />
              </PieChart>
            </div>
            {entries.some((entry) => entry.onSelect) && (
              <p id={`${titleId}-hint`} className="text-xs text-muted">
                Select a row to filter inventory.
              </p>
            )}
            <ul aria-label={`${title} counts`} className="space-y-1">
              {chartData.map((entry) => {
                const percentage = total > 0 ? Math.round((entry.count / total) * 100) : 0;
                const contents = (
                  <>
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: entry.color }}
                    />
                    <span className="min-w-0 flex-1 text-left [overflow-wrap:anywhere]">
                      {entry.label}
                    </span>
                    <span className="shrink-0 text-muted">{percentage}%</span>
                    <span className="shrink-0 font-semibold">{entry.count}</span>
                  </>
                );
                const rowClass =
                  "flex min-h-11 w-full items-center gap-2 rounded-sm px-2 py-2 text-xs text-foreground";
                return (
                  <li key={entry.id}>
                    {entry.onSelect ? (
                      <button
                        type="button"
                        className={`${rowClass} cursor-pointer hover:bg-container-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`}
                        aria-describedby={`${titleId}-hint`}
                        onClick={entry.onSelect}
                      >
                        {contents}
                      </button>
                    ) : (
                      <div className={rowClass}>{contents}</div>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="mt-auto flex items-center justify-between border-t border-border px-2 pt-3 text-xs text-foreground">
              <span>Total</span>
              <span className="font-semibold">{total}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
