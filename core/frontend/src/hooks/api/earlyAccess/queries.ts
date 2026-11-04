import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiRequest } from "@app/config/request";

import { adminStandaloneKeys } from "../admin/queries";
import {
  TEarlyAccessBulkDeleteFilter,
  TEarlyAccessFilter,
  TEarlyAccessInvitation,
  TEarlyAccessRequest,
  TEarlyAccessRequestsResponse,
  TInviteEarlyAccessRequestResponse
} from "./types";

const BASE_URL = "/api/v1/early-access/requests";

const earlyAccessKeys = {
  all: ["early-access-requests"] as const,
  list: (filter: TEarlyAccessFilter) => [...earlyAccessKeys.all, filter] as const
};

export const useGetEarlyAccessRequests = (filter: TEarlyAccessFilter) =>
  useQuery({
    queryKey: earlyAccessKeys.list(filter),
    queryFn: async () => {
      const { data } = await apiRequest.get<TEarlyAccessRequestsResponse>(BASE_URL, {
        params: filter
      });
      return data;
    },
    placeholderData: keepPreviousData
  });

export const useInviteEarlyAccessRequest = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      requestId,
      organizationName
    }: {
      requestId: string;
      organizationName: string;
    }) => {
      const { data } = await apiRequest.post<TInviteEarlyAccessRequestResponse>(
        `${BASE_URL}/${requestId}/invite`,
        { organizationName }
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: earlyAccessKeys.all });
      queryClient.invalidateQueries({ queryKey: [adminStandaloneKeys.getOrganizations] });
    }
  });
};

export const useReissueEarlyAccessInvitation = () =>
  useMutation({
    mutationFn: async (requestId: string) => {
      const { data } = await apiRequest.post<{ invitation: TEarlyAccessInvitation }>(
        `${BASE_URL}/${requestId}/reissue-invitation`
      );
      return data.invitation;
    }
  });

export const useDeleteMatchingEarlyAccessRequests = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (filter: TEarlyAccessBulkDeleteFilter) => {
      const { data } = await apiRequest.post<{ deletedCount: number }>(
        `${BASE_URL}/delete-matching`,
        filter
      );
      return data.deletedCount;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: earlyAccessKeys.all })
  });
};

export const useDeclineEarlyAccessRequest = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: string) => {
      const { data } = await apiRequest.post<{ request: TEarlyAccessRequest }>(
        `${BASE_URL}/${requestId}/decline`
      );
      return data.request;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: earlyAccessKeys.all })
  });
};

export const useDeleteEarlyAccessRequest = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: string) => {
      const { data } = await apiRequest.delete<{ request: TEarlyAccessRequest }>(
        `${BASE_URL}/${requestId}`
      );
      return data.request;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: earlyAccessKeys.all })
  });
};
