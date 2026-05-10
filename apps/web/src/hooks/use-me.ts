'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { Me } from '@/types/user';

/**
 * Universal "who is the current user?" hook.
 *
 * No Context provider needed: React Query already deduplicates concurrent
 * queries for the same key, so calling useMe() in 10 components fires
 * exactly one /auth/me request and shares the result.
 *
 * retry: false because 401 means "log in," not "try again."
 * staleTime is generous because the user object barely changes.
 */
export function useMe() {
  return useQuery<Me>({
    queryKey: queryKeys.me,
    queryFn: () => api<Me>('/auth/me'),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}
