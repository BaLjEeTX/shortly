// frontend/src/hooks/useUrls.ts
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { urlsApi } from '../api/urls';

export function useUrls() {
  return useInfiniteQuery({
    queryKey: ['urls'],
    queryFn: ({ pageParam }) => urlsApi.list(pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
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
