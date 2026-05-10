'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useMe } from '@/hooks/use-me';

/**
 * /portal — role-based landing.
 *
 * Every role lands here after login; we redirect to the most-useful page
 * for them. The (portal)/layout handles the 401 → /login case, so we know
 * if me is present we're authenticated.
 */
export default function PortalIndex() {
  const router = useRouter();
  const { data: me } = useMe();

  useEffect(() => {
    if (!me) return;
    // All roles currently land on /applications — the visibility filter
    // shows them the right slice. If we add an admin dashboard or a
    // dedicated reviewer queue page later, this is where to fan out.
    router.replace('/applications');
  }, [me, router]);

  return <div className="text-sm text-gray-500">Redirecting…</div>;
}
