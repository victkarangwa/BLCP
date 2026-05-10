import { redirect } from 'next/navigation';

/**
 * Root URL → /portal.
 *
 * If the user is authenticated, the portal layout shows them the right
 * landing page (/applications). If not, the portal layout's auth gate
 * redirects them to /login. Either way, no decision logic here — defer
 * to the layout that has the user state.
 */
export default function Home() {
  redirect('/portal');
}
