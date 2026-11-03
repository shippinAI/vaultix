import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiRequest } from "@app/config/request";

import { adminStandaloneKeys } from "../admin/queries";
import {
  TEarlyAccessFilter,
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
