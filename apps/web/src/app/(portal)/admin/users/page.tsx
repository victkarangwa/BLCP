'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useMe } from '@/hooks/use-me';
import { Skeleton } from '@/components/skeleton';
import { ErrorState } from '@/components/error-state';
import type { UserListResponse, UserRole, UserListItem } from '@/types/user';

/**
 * Admin user-management page.
 *
 *   - List of users with role + active state.
 *   - Inline "Create user" form (collapsed by default to keep the page calm).
 *   - Per-row action button: deactivate active users / reactivate inactive ones.
 *
 * The admin's own row is excluded from action buttons (backend would 403
 * anyway, but the UI shouldn't tempt). Role demotion intentionally not
 * exposed in v1 — it's an axe for a power tool; getting it wrong locks
 * the platform out. Add a confirm modal before shipping that surface.
 *
 * Non-admins shouldn't reach this page (backend 403s), but we render a
 * friendly fallback for graceful failure if they do.
 */

const ROLES: UserRole[] = ['APPLICANT', 'REVIEWER', 'APPROVER', 'ADMIN'];

export default function AdminUsersPage() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [showCreate, setShowCreate] = useState(false);

  const { data, error, isLoading, refetch } = useQuery<UserListResponse>({
    queryKey: queryKeys.users.all,
    queryFn: () => api<UserListResponse>('/users'),
    enabled: me?.role === 'ADMIN',
  });

  const toggleActive = useMutation({
    mutationFn: (u: UserListItem) =>
      api(`/users/${u.id}`, {
        method: 'PATCH',
        body: { isActive: !u.isActive },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.users.all }),
  });

  if (me && me.role !== 'ADMIN') {
    return (
      <p className="text-sm text-gray-600">
        Only administrators can manage users.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Users</h1>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          {showCreate ? 'Cancel' : 'New user'}
        </button>
      </header>

      {showCreate && <CreateUserForm onDone={() => setShowCreate(false)} />}

      {isLoading ? (
        <Skeleton rows={4} />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : !data || data.items.length === 0 ? (
        <p className="text-sm text-gray-500">No users found.</p>
      ) : (
        <div className="overflow-hidden rounded border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.items.map((u) => {
                const isSelf = me?.id === u.id;
                return (
                  <tr key={u.id} className={u.isActive ? '' : 'bg-gray-50'}>
                    <td className="px-4 py-3 font-mono text-xs text-gray-900">
                      {u.email}
                    </td>
                    <td className="px-4 py-3 text-gray-900">{u.fullName}</td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {u.isActive ? (
                        <span className="text-xs text-green-700">Active</span>
                      ) : (
                        <span className="text-xs text-gray-500">Inactive</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isSelf ? (
                        <span className="text-xs text-gray-400">You</span>
                      ) : (
                        <button
                          onClick={() => toggleActive.mutate(u)}
                          disabled={toggleActive.isPending}
                          className={`text-xs font-medium hover:underline disabled:opacity-50 ${
                            u.isActive ? 'text-red-700' : 'text-blue-700'
                          }`}
                        >
                          {u.isActive ? 'Deactivate' : 'Reactivate'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CreateUserForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('APPLICANT');

  const create = useMutation({
    mutationFn: () =>
      api('/users', {
        method: 'POST',
        body: { email, password, fullName, role },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.users.all });
      onDone();
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
      className="grid grid-cols-1 gap-3 rounded border border-gray-200 bg-white p-4 sm:grid-cols-2"
    >
      <label className="block">
        <span className="block text-xs font-medium text-gray-700">Email</span>
        <input
          type="email" required maxLength={254}
          value={email} onChange={(e) => setEmail(e.target.value)}
          className="mt-1 block w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-gray-700">Full name</span>
        <input
          type="text" required minLength={2} maxLength={200}
          value={fullName} onChange={(e) => setFullName(e.target.value)}
          className="mt-1 block w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-gray-700">
          Password (min 12 chars)
        </span>
        <input
          type="password" required minLength={12} maxLength={128}
          value={password} onChange={(e) => setPassword(e.target.value)}
          className="mt-1 block w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-gray-700">Role</span>
        <select
          value={role} onChange={(e) => setRole(e.target.value as UserRole)}
          className="mt-1 block w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>

      {create.error instanceof ApiError && (
        <p className="col-span-full text-xs text-red-700">
          {create.error.message}
        </p>
      )}

      <div className="col-span-full flex gap-2">
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {create.isPending ? 'Creating…' : 'Create user'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
