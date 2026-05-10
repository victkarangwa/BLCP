import type { ReactNode } from 'react';

/**
 * Empty state. Tone matters: a reviewer with no queue should see
 * "No applications waiting for review" — not "No data."
 */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded border border-dashed border-gray-300 bg-white p-8 text-center">
      <p className="text-sm font-medium text-gray-700">{title}</p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
