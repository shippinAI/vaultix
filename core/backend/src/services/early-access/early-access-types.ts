export const EARLY_ACCESS_STATUSES = ["pending", "invited", "declined"] as const;

export type TEarlyAccessStatus = (typeof EARLY_ACCESS_STATUSES)[number];

export type TEarlyAccessSubmission = {
  email: string;
  name: string | null;
  organization: string | null;
  useCase: string | null;
};

export type TEarlyAccessListFilter = {
  status?: TEarlyAccessStatus;
  search?: string;
  limit: number;
  offset: number;
};
