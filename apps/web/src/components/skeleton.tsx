/**
 * Skeleton placeholder. Renders the shape of the page with gray boxes so
 * the layout doesn't shift when data arrives — feels faster than a spinner.
 */
export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 animate-pulse rounded bg-gray-200" />
      ))}
    </div>
  );
}
