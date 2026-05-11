'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

/**
 * Document upload form. Renders only in mutable states (DRAFT,
 * INFO_REQUESTED, RESUBMITTED) — the parent decides whether to mount us.
 *
 *   - Client-side size check fails fast (saves bandwidth on > 5MB files).
 *     The server still enforces 5MB via Multer + service-layer check.
 *
 *   - Idempotency-Key per submit attempt: the same submission retried
 *     replays the response server-side rather than creating duplicates.
 *     We mint a fresh key on every submit click (not per mount) so the
 *     user can do "submit, change file, submit again" and get two
 *     genuine uploads.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = '.pdf,.png,.jpg,.jpeg';

const DOCUMENT_TYPES = [
  { value: 'BUSINESS_PLAN', label: 'Business plan' },
  { value: 'FINANCIAL_STATEMENTS', label: 'Financial statements' },
  { value: 'DIRECTORS_PROFILE', label: 'Directors profile' },
  { value: 'PROOF_OF_CAPITAL', label: 'Proof of capital' },
  { value: 'OTHER', label: 'Other' },
];

export function DocumentUpload({ applicationId }: { applicationId: string }) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState(DOCUMENT_TYPES[0].value);
  const [clientError, setClientError] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('No file selected');
      if (file.size > MAX_BYTES) {
        throw new Error(
          `File is ${(file.size / 1024 / 1024).toFixed(2)} MB; max is 5 MB.`,
        );
      }
      const fd = new FormData();
      fd.append('file', file);
      fd.append('documentType', documentType);

      return api(`/applications/${applicationId}/documents`, {
        method: 'POST',
        body: fd,
        idempotencyKey: crypto.randomUUID(),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: queryKeys.documents.forApplication(applicationId),
      });
      // Detail (updatedAt) + audit timeline (new DOCUMENT_UPLOADED row).
      // queryKeys.applications.audit() is a prefix-match below
      // applications.all, but we invalidate explicitly for clarity.
      qc.invalidateQueries({
        queryKey: queryKeys.applications.detail(applicationId),
      });
      qc.invalidateQueries({
        queryKey: queryKeys.applications.audit(applicationId),
      });
      setFile(null);
      setClientError(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
  });

  const serverError =
    upload.error instanceof ApiError ? upload.error : null;
  const message =
    clientError ??
    (upload.error instanceof Error && !(upload.error instanceof ApiError)
      ? upload.error.message
      : null) ??
    serverError?.message ??
    null;

  return (
    <section className="rounded border border-gray-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-900">Upload document</h2>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
        <div>
          <label className="block text-xs font-medium text-gray-700">Type</label>
          <select
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value)}
            className="mt-1 block w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {DOCUMENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>

          <label className="mt-3 block text-xs font-medium text-gray-700">
            File (PDF/PNG/JPEG, ≤ 5 MB)
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && f.size > MAX_BYTES) {
                setClientError(
                  `File is ${(f.size / 1024 / 1024).toFixed(2)} MB; max is 5 MB.`,
                );
              } else {
                setClientError(null);
              }
            }}
            className="mt-1 block w-full text-sm text-gray-700 file:mr-3 file:rounded file:border file:border-gray-300 file:bg-white file:px-3 file:py-1 file:text-xs file:font-medium file:text-gray-700 file:hover:bg-gray-50"
          />
        </div>

        <div className="flex items-end">
          <button
            onClick={() => upload.mutate()}
            disabled={!file || !!clientError || upload.isPending}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {upload.isPending ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </div>

      {message && (
        <p className="mt-3 text-xs text-red-700" role="alert">
          {message}
        </p>
      )}
    </section>
  );
}
