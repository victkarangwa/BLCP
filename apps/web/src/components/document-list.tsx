'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { Skeleton } from './skeleton';
import { ErrorState } from './error-state';
import { EmptyState } from './empty-state';
import type { DocumentListItem } from '@/types/document';

/**
 * List of latest documents per documentType for an application.
 *
 *   - Download links use the API's /documents/:id/download endpoint;
 *     the browser handles auth via the session cookie automatically
 *     (no Authorization header required).
 *
 *   - We render the totalVersions count so users can see at a glance
 *     when a document has been re-uploaded. A real "version history"
 *     drawer is a future enhancement — for the take-home, the count
 *     plus "v2" badge is enough.
 */
const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3000/api/v1';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function DocumentList({ applicationId }: { applicationId: string }) {
  const { data, error, isLoading, refetch } = useQuery<DocumentListItem[]>({
    queryKey: queryKeys.documents.forApplication(applicationId),
    queryFn: () =>
      api<DocumentListItem[]>(`/applications/${applicationId}/documents`),
  });

  if (isLoading) return <Skeleton rows={2} />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!data || data.length === 0) {
    return (
      <EmptyState
        title="No documents yet"
        hint="Documents added to this application appear here."
      />
    );
  }

  return (
    <div className="overflow-hidden rounded border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
          <tr>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3">File</th>
            <th className="px-4 py-3">Size</th>
            <th className="px-4 py-3">Uploaded</th>
            <th className="px-4 py-3 text-right">Download</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {data.map((d) => (
            <tr key={d.id} className="hover:bg-gray-50">
              <td className="px-4 py-3">
                <div className="font-mono text-xs text-gray-700">
                  {d.documentType}
                </div>
                <div className="mt-0.5 text-[10px] text-gray-500">
                  v{d.version}
                  {d.totalVersions > 1 && ` of ${d.totalVersions}`}
                </div>
              </td>
              <td className="px-4 py-3 text-gray-900">{d.originalName}</td>
              <td className="px-4 py-3 text-gray-600">{formatSize(d.sizeBytes)}</td>
              <td className="px-4 py-3 text-xs text-gray-500">
                {new Date(d.uploadedAt).toLocaleDateString()}
                <span className="text-gray-400"> · {d.uploadedBy.fullName}</span>
              </td>
              <td className="px-4 py-3 text-right">
                <a
                  href={`${API_BASE}/documents/${d.id}/download`}
                  className="text-xs font-medium text-blue-700 hover:underline"
                  // Cookies handle auth automatically; we just need the
                  // browser to GET this URL. No download attribute so the
                  // server's Content-Disposition is honored.
                >
                  Download
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
