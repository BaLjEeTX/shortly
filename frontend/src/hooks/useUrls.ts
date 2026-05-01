// frontend/src/hooks/useUrls.ts
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { urlsApi, type UrlResponse } from '../api/urls';
import { apiClient } from '../api/client';

export function useUrls() {
  return useInfiniteQuery({
    queryKey: ['urls'],
    queryFn: ({ pageParam }) => urlsApi.list(pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

interface CreateAnonymousRequest {
  longUrl: string;
  durationMinutes: number;
}

export function useCreateAnonymousUrl() {
  return useMutation({
    mutationFn: async (req: CreateAnonymousRequest) => {
      const { data } = await apiClient.post<UrlResponse>("/api/v1/urls/anonymous", req);
      return data;
    },
  });
}

export function useCreateUrl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: urlsApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['urls'] }),
  });
}

export function useDeleteUrl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: urlsApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['urls'] }),
  });
}
