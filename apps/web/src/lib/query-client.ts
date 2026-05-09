'use client';

import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api-client';

/**
 * Query client with deliberate retry/refetch policy.
 *
 *   - Don't retry 4xx queries. They won't change.
 *   - Don't auto-retry mutations. Retried POSTs cause duplicates;
 *     idempotency keys handle the legitimate-retry case explicitly.
 *   - Don't refetch on window focus. Surprise refetches are jarring.
 *     We invalidate after mutations so the cache stays accurate.
 */
export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,
        gcTime: 5 * 60 * 1000,
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
            return false;
          }
          return failureCount < 2;
        },
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
