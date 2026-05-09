'use client';

import { useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@/lib/query-client';

/**
 * Client-side provider wrapper.
 *
 * QueryClient is created inside useState so each browser tab gets its own
 * instance (important for hydration). The function form prevents the client
 * from being recreated on every render.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
