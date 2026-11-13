export type TEarlyAccessStatus = "pending" | "invited" | "declined";

export type TEarlyAccessRequest = {
  id: string;
  email: string;
  name?: string | null;
  organization?: string | null;
  useCase?: string | null;
  status: TEarlyAccessStatus;
  reviewedAt?: string | null;
  invitedOrgId?: string | null;
  createdAt: string;
};

export type TEarlyAccessFilter = {
  status?: TEarlyAccessStatus;
  search?: string;
  limit: number;
  offset: number;
};

export type TEarlyAccessBulkDeleteFilter = {
  status: "pending" | "declined";
  search?: string;
};

export type TEarlyAccessRequestsResponse = {
  requests: TEarlyAccessRequest[];
  totalCount: number;
  pendingCount: number;
};

export type TEarlyAccessInvitation =
  | { email: string; delivery: "email" }
  | { email: string; delivery: "link"; link: string }
  | { email: string; delivery: "failed" };

export type TInviteEarlyAccessRequestResponse = {
  request: TEarlyAccessRequest;
  organization: { id: string; name: string };
  invitation?: TEarlyAccessInvitation;
};
