import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiRequest } from "@app/config/request";

import {
  TAssistantMemory,
  TAssistantMemoryInput,
  TAssistantMessage,
  TAssistantPersona,
  TAssistantPersonaInput,
  TAssistantPersonaRole,
  TAssistantPersonaTier,
  TAssistantProvider,
  TAssistantProviderInput,
  TAssistantProviderKind,
  TAssistantProviderModels,
  TAssistantProviderTest,
  TAssistantReply,
  TAssistantSignal,
  TAssistantStatus
} from "./types";

const BASE_URL = "/api/vx/v1/ai";

export const assistantKeys = {
  all: ["vaultix-assistant"] as const,
  status: () => [...assistantKeys.all, "status"] as const,
  providers: () => [...assistantKeys.all, "providers"] as const,
  personas: () => [...assistantKeys.all, "personas"] as const,
  providerModels: (id: string) => [...assistantKeys.all, "provider-models", id] as const,
  memories: () => [...assistantKeys.all, "memories"] as const
};

export const useGetAssistantStatus = (enabled = true) =>
  useQuery({
    queryKey: assistantKeys.status(),
    enabled,
    queryFn: async () => {
      const { data } = await apiRequest.get<{ assistant: TAssistantStatus }>(
        `${BASE_URL}/assistant`
      );
      return data.assistant;
    }
  });

export const useGetAssistantProviders = () =>
  useQuery({
    queryKey: assistantKeys.providers(),
    queryFn: async () => {
      const { data } = await apiRequest.get<{
        providers: TAssistantProvider[];
        kinds: TAssistantProviderKind[];
      }>(`${BASE_URL}/providers`);
      return data;
    }
  });

export const useGetAssistantPersonas = () =>
  useQuery({
    queryKey: assistantKeys.personas(),
    queryFn: async () => {
      const { data } = await apiRequest.get<{
        personas: TAssistantPersona[];
        domains: string[];
        roles: TAssistantPersonaRole[];
        tiers: TAssistantPersonaTier[];
      }>(`${BASE_URL}/personas`);
      return data;
    }
  });

// Asks the provider live; only fetched when the administrator asks for it.
export const useGetAssistantProviderModels = (id: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: assistantKeys.providerModels(id ?? ""),
    enabled: enabled && Boolean(id),
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      const { data } = await apiRequest.get<TAssistantProviderModels>(
        `${BASE_URL}/providers/${id}/models`
      );
      return data;
    }
  });

export const useGetAssistantMemories = (enabled = true) =>
  useQuery({
    queryKey: assistantKeys.memories(),
    enabled,
    queryFn: async () => {
      const { data } = await apiRequest.get<{
        memories: TAssistantMemory[];
        canManageInstance: boolean;
      }>(`${BASE_URL}/memories`);
      return data;
    }
  });

const useInvalidateMemories = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: assistantKeys.memories() });
};

export const useCreateAssistantMemory = () => {
  const invalidate = useInvalidateMemories();
  return useMutation({
    mutationFn: async (input: TAssistantMemoryInput) => {
      const { data } = await apiRequest.post<{ memory: TAssistantMemory }>(
        `${BASE_URL}/memories`,
        input
      );
      return data.memory;
    },
    onSuccess: invalidate
  });
};

export const useUpdateAssistantMemory = () => {
  const invalidate = useInvalidateMemories();
  return useMutation({
    mutationFn: async ({ id, ...input }: TAssistantMemoryInput & { id: string }) => {
      const { data } = await apiRequest.patch<{ memory: TAssistantMemory }>(
        `${BASE_URL}/memories/${id}`,
        input
      );
      return data.memory;
    },
    onSuccess: invalidate
  });
};

export const useDeleteAssistantMemory = () => {
  const invalidate = useInvalidateMemories();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiRequest.delete<{ memory: TAssistantMemory }>(
        `${BASE_URL}/memories/${id}`
      );
      return data.memory;
    },
    onSuccess: invalidate
  });
};

const useInvalidateAssistant = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: assistantKeys.all });
};

export const useCreateAssistantProvider = () => {
  const invalidate = useInvalidateAssistant();
  return useMutation({
    mutationFn: async (input: TAssistantProviderInput) => {
      const { data } = await apiRequest.post<{ provider: TAssistantProvider }>(
        `${BASE_URL}/providers`,
        input
      );
      return data.provider;
    },
    onSuccess: invalidate
  });
};

export const useUpdateAssistantProvider = () => {
  const invalidate = useInvalidateAssistant();
  return useMutation({
    mutationFn: async ({ id, ...input }: TAssistantProviderInput & { id: string }) => {
      const { data } = await apiRequest.patch<{ provider: TAssistantProvider }>(
        `${BASE_URL}/providers/${id}`,
        input
      );
      return data.provider;
    },
    onSuccess: invalidate
  });
};

export const useDeleteAssistantProvider = () => {
  const invalidate = useInvalidateAssistant();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiRequest.delete<{ provider: TAssistantProvider }>(
        `${BASE_URL}/providers/${id}`
      );
      return data.provider;
    },
    onSuccess: invalidate
  });
};

export const useTestAssistantProvider = () => {
  const invalidate = useInvalidateAssistant();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiRequest.post<{
        test: TAssistantProviderTest;
        provider: TAssistantProvider;
      }>(`${BASE_URL}/providers/${id}/test`);
      return data;
    },
    onSuccess: invalidate
  });
};

export const useCreateAssistantPersona = () => {
  const invalidate = useInvalidateAssistant();
  return useMutation({
    mutationFn: async (input: TAssistantPersonaInput) => {
      const { data } = await apiRequest.post<{ persona: TAssistantPersona }>(
        `${BASE_URL}/personas`,
        input
      );
      return data.persona;
    },
    onSuccess: invalidate
  });
};

export const useUpdateAssistantPersona = () => {
  const invalidate = useInvalidateAssistant();
  return useMutation({
    mutationFn: async ({ slug, ...input }: TAssistantPersonaInput & { slug: string }) => {
      const { data } = await apiRequest.patch<{ persona: TAssistantPersona }>(
        `${BASE_URL}/personas/${slug}`,
        input
      );
      return data.persona;
    },
    onSuccess: invalidate
  });
};

export const useResetAssistantPersona = () => {
  const invalidate = useInvalidateAssistant();
  return useMutation({
    mutationFn: async (slug: string) => {
      const { data } = await apiRequest.post<{ persona: TAssistantPersona }>(
        `${BASE_URL}/personas/${slug}/reset`
      );
      return data.persona;
    },
    onSuccess: invalidate
  });
};

export const useDeleteAssistantPersona = () => {
  const invalidate = useInvalidateAssistant();
  return useMutation({
    mutationFn: async (slug: string) => {
      const { data } = await apiRequest.delete<{ persona: TAssistantPersona }>(
        `${BASE_URL}/personas/${slug}`
      );
      return data.persona;
    },
    onSuccess: invalidate
  });
};

export const useSendAssistantMessage = () =>
  useMutation({
    mutationFn: async (input: {
      messages: TAssistantMessage[];
      signals: TAssistantSignal[];
      persona?: string;
    }) => {
      const { data } = await apiRequest.post<TAssistantReply>(`${BASE_URL}/messages`, input);
      return data;
    }
  });
