import type { TExpirationBucket } from "@app/hooks/api/certificates";

import { CertificateDistributionCard } from "./CertificateDistributionCard";

type Props = {
  buckets: TExpirationBucket[];
  onNavigate: (filters: Record<string, string | undefined>) => void;
};

const DONUT_SEGMENTS = [
  {
    label: "< 7 days",
    sourceBuckets: ["expired", "0-7d"],
    filter: { filterExpiresDays: "7" }
  },
  {
    label: "7-30 days",
    sourceBuckets: ["8-30d"],
    filter: { filterExpiresAfterDays: "7", filterExpiresDays: "30" }
  },
  {
    label: "> 30 days",
    sourceBuckets: ["31-60d", "61-90d", "90d+"],
    filter: { filterExpiresAfterDays: "30" }
  }
];

export const ExpirationTimeline = ({ buckets, onNavigate }: Props) => {
  const bucketMap = new Map(buckets.map((bucket) => [bucket.bucket, bucket.count]));

  return (
    <CertificateDistributionCard
      title="Expiration Timeline"
      description="Certificates by time to expiry"
      emptyMessage="No expiration data"
      entries={DONUT_SEGMENTS.map((segment) => ({
        id: segment.label,
        label: segment.label,
        count: segment.sourceBuckets.reduce((sum, key) => sum + (bucketMap.get(key) ?? 0), 0),
        onSelect: () => onNavigate(segment.filter)
      }))}
    />
  );
};
