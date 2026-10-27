import type { TDashboardDistribution, TDashboardStats } from "@app/hooks/api/certificates";
import { certKeyAlgorithmToNameMap } from "@app/hooks/api/certificates/constants";

import { CertificateChartEntry, CertificateDistributionCard } from "./CertificateDistributionCard";

type Props = {
  stats: TDashboardStats;
  onNavigate: (filters: Record<string, string | undefined>) => void;
};

type ChartKey = "enrollmentMethod" | "algorithm" | "ca";

export const DistributionCharts = ({ stats, onNavigate }: Props) => {
  const charts: {
    title: string;
    description: string;
    key: ChartKey;
    data: TDashboardDistribution[];
  }[] = [
    {
      title: "By Enrollment Method",
      description: "Distribution by enrollment type",
      key: "enrollmentMethod",
      data: stats.distributions.byEnrollmentMethod
    },
    {
      title: "By Algorithm",
      description: "Distribution by key algorithm",
      key: "algorithm",
      data: stats.distributions.byAlgorithm
    },
    {
      title: "By Issuing CA",
      description: "Distribution by certificate authority",
      key: "ca",
      data: stats.distributions.byCA
    }
  ];

  return (
    <>
      {charts.map((chart) => {
        const entries: CertificateChartEntry[] = chart.data
          .filter((entry) => entry.count > 0)
          .map((entry, index) => {
            let { label } = entry;
            let filter: Record<string, string> | undefined;
            if (chart.key === "enrollmentMethod") {
              label = entry.label.toUpperCase();
              filter = { filterEnrollmentType: entry.label };
            } else if (chart.key === "algorithm") {
              label =
                (certKeyAlgorithmToNameMap as Record<string, string>)[entry.label] ??
                entry.label.replace(/_/g, " ");
              if (entry.label !== "Unknown") filter = { filterKeyAlgorithm: entry.label };
            } else if (entry.id) {
              filter = { filterCaId: entry.id };
            }
            const selectedFilter = filter;
            return {
              id: `${entry.id ?? entry.label}-${index}`,
              label,
              count: entry.count,
              onSelect: selectedFilter ? () => onNavigate(selectedFilter) : undefined
            };
          });
        return (
          <CertificateDistributionCard
            key={chart.key}
            title={chart.title}
            description={chart.description}
            entries={entries}
          />
        );
      })}
    </>
  );
};
