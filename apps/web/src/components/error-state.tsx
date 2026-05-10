'use client';

import { ApiError } from '@/lib/api-client';

/**
 * Generic error state for query failures.
 *
 *   - Short, plain-English message.
 *   - The requestId so users can quote it in support tickets.
 *   - A retry button when an onRetry handler is provided.
 *
 * Note: 401s should be handled at the layout level (auth gate → redirect),
 * not surfaced as an ErrorState. If you see "Unauthorized" here, something
 * upstream isn't catching it.
 */
export function ErrorState({
  error,
  onRetry,
  title = "Couldn't load this view",
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  const requestId =
    error instanceof ApiError && error.requestId ? error.requestId : undefined;
  const message =
    error instanceof ApiError ? error.message : 'Something went wrong.';

  return (
    <div
      className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800"
      role="alert"
    >
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-red-700">{message}</p>
      {requestId && (
        <p className="mt-2 text-xs text-red-600">Reference: {requestId}</p>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 inline-flex rounded border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
        >
          Try again
        </button>
      )}
    </div>
  );
}
