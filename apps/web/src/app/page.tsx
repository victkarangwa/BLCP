import { redirect } from 'next/navigation';

/**
 * Root URL behaviour:
 *  - If we knew the user was authenticated server-side, we'd send them to /portal.
 *  - With cookie-based auth and a client-side useMe hook, we can't know on the
 *    server. Simplest correct behaviour: send them to /login. Authenticated
 *    users get redirected onward by the login page once it sees an active session.
 *
 * (When the auth module is wired up, the (portal) layout's useMe gate will
 *  also redirect to /login on 401, closing the loop in both directions.)
 */
export default function Home() {
  redirect('/login');
}
