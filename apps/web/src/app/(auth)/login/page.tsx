/**
 * Login page placeholder.
 *
 * The real implementation (form + useMutation against /auth/login) drops in
 * once the backend Auth module is wired up. Keeping the route stub here so
 * the App Router builds cleanly and the redirect from / lands somewhere
 * meaningful in the meantime.
 */
export default function LoginPage() {
  return (
    <main className="mx-auto mt-24 max-w-sm space-y-4 rounded-lg border bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold">BNR Licensing Portal</h1>
      <p className="text-sm text-gray-600">
        Sign in is not yet implemented. The auth module is the next step.
      </p>
    </main>
  );
}
