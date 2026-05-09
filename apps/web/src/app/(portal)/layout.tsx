/**
 * Portal layout placeholder.
 *
 * Will be replaced with the role-aware sidebar + auth gate (useMe + redirect
 * on 401) once the auth module exists. For now it just renders children so
 * the route group resolves.
 */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <main className="p-8">{children}</main>;
}
