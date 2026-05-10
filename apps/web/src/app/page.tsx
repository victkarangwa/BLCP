import { redirect } from 'next/navigation';

/**
 * Root URL → /applications.
 *
 * The applications page sits inside the (portal) route group, so the
 * (portal)/layout auth gate runs first. Unauthenticated users get
 * redirected to /login from there. Authenticated users see their
 * role-filtered application list.
 *
 * We don't have a separate /portal URL: the route group's parens are
 * non-routing, so `(portal)/applications/page.tsx` is just `/applications`.
 */
export default function Home() {
  redirect('/applications');
}
