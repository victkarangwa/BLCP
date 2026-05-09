/**
 * Centralized query key catalog.
 *
 * Why a central object:
 *   - Surgical invalidation. After approving an application we invalidate
 *     exactly detail/actions/audit/list — not documents, not users.
 *   - One place to refactor when keys change.
 *   - The keys are typed as `as const` so TypeScript catches typos.
 */
export const queryKeys = {
  me: ['me'] as const,
  applications: {
    all: ['applications'] as const,
    list: (filters?: { state?: string }) => ['applications', 'list', filters] as const,
    detail: (id: string) => ['applications', 'detail', id] as const,
    actions: (id: string) => ['applications', 'actions', id] as const,
    audit: (id: string) => ['applications', 'audit', id] as const,
  },
  documents: {
    forApplication: (id: string) => ['documents', id] as const,
  },
  users: {
    all: ['users'] as const,
  },
} as const;
