'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

/**
 * Login page.
 *
 *   - The API sets bnr_session + bnr_csrf cookies on success; we don't
 *     touch tokens in JS at all. fetch(credentials:'include') in the
 *     api client makes the browser carry them.
 *
 *   - The error message is intentionally the same for wrong-email and
 *     wrong-password. The backend already enforces this (constant-time
 *     login, single 'INVALID_CREDENTIALS' code); the UI preserves it.
 *
 *   - On success we invalidate the 'me' query and push to /portal, which
 *     does the role-based redirect.
 */
export default function LoginPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const login = useMutation({
    mutationFn: () =>
      api('/auth/login', {
        method: 'POST',
        body: { email, password },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.me });
      router.push('/portal');
    },
  });

  const errorMessage = (() => {
    if (!login.error) return null;
    if (login.error instanceof ApiError) {
      if (login.error.status === 429) {
        return 'Too many login attempts. Try again in a minute.';
      }
      // Same message for all 401 reasons — backend already returns
      // INVALID_CREDENTIALS regardless of why.
      return 'Invalid email or password.';
    }
    return 'Something went wrong. Please try again.';
  })();

  return (
    <main className="mx-auto mt-24 max-w-sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate();
        }}
        className="space-y-4 rounded-lg border bg-white p-6 shadow-sm"
      >
        <div>
          <h1 className="text-xl font-semibold text-gray-900">BNR Licensing Portal</h1>
          <p className="mt-1 text-sm text-gray-500">Sign in to continue.</p>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="block text-sm font-medium text-gray-700">Email</span>
            <input
              type="email"
              required
              autoFocus
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </label>

          <label className="block">
            <span className="block text-sm font-medium text-gray-700">Password</span>
            <input
              type="password"
              required
              minLength={12}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </label>
        </div>

        {errorMessage && (
          <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {errorMessage}
          </div>
        )}

        <button
          type="submit"
          disabled={login.isPending}
          className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="text-xs text-gray-500">
          Seed credentials (dev): <code>admin@bnr.seed</code> /{' '}
          <code>Passw0rd!ChangeMe</code>
        </p>
      </form>
    </main>
  );
}
