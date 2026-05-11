'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api-client';
import { useMe } from '@/hooks/use-me';

/**
 * Portal layout — wraps every authenticated page.
 *
 *   - Auth gate: on 401 from /auth/me, redirect to /login.
 *     This is the only place we do this; child pages assume `me` is present.
 *
 *   - Role-aware sidebar: hide links a role can't use. (Backend still
 *     enforces. The UI is just helpful, not authoritative.)
 *
 *   - Logout: POSTs /auth/logout, clears the query cache, redirects.
 *     We clear() the cache to avoid a stale-data flash if a different
 *     user logs in next on the same browser.
 */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const { data: me, error, isLoading } = useMe();

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) {
      router.replace('/login');
    }
  }, [error, router]);

  const logout = useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      qc.clear();
      router.replace('/login');
    },
  });

  if (isLoading) {
    return <div className="p-8 text-sm text-gray-500">Loading…</div>;
  }
  if (!me) return null; // mid-redirect

  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 border-r border-gray-200 bg-white p-4">
        <div className="mb-6">
          <div className="text-base font-semibold text-gray-900">BNR Portal</div>
          <div className="mt-2 text-xs text-gray-500">{me.fullName}</div>
          <div className="text-[10px] uppercase tracking-wider text-gray-400">
            {me.role}
          </div>
        </div>

        <nav className="space-y-1">
          {(me.role === 'APPLICANT' || me.role === 'ADMIN') && (
            <NavLink href="/applications" pathname={pathname}>
              {me.role === 'ADMIN' ? 'All applications' : 'My applications'}
            </NavLink>
          )}
          {(me.role === 'REVIEWER' || me.role === 'APPROVER') && (
            <NavLink href="/applications" pathname={pathname}>
              Queue
            </NavLink>
          )}
          {me.role === 'APPLICANT' && (
            <NavLink href="/applications/new" pathname={pathname}>
              New application
            </NavLink>
          )}
          {me.role === 'ADMIN' && (
            <NavLink href="/admin/users" pathname={pathname}>
              Users
            </NavLink>
          )}
        </nav>

        <button
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          className="mt-8 text-xs text-gray-500 hover:text-gray-900 disabled:opacity-50"
        >
          {logout.isPending ? 'Signing out…' : 'Sign out'}
        </button>
      </aside>

      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}

function NavLink({
  href,
  pathname,
  children,
}: {
  href: string;
  pathname: string | null;
  children: React.ReactNode;
}) {
  const active = pathname === href || pathname?.startsWith(href + '/');
  return (
    <Link
      href={href}
      className={`block rounded px-3 py-2 text-sm ${
        active
          ? 'bg-blue-50 font-medium text-blue-700'
          : 'text-gray-700 hover:bg-gray-100'
      }`}
    >
      {children}
    </Link>
  );
}
