'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type {
  WorkflowAction,
  AvailableActionsResponse,
} from '@/types/application';

/**
 * Workflow action panel.
 *
 * Three guiding decisions:
 *
 *   1. The button list is driven entirely by GET /available-actions.
 *      The frontend has no state-machine knowledge of its own. If the
 *      backend says you can SUBMIT and APPROVE, those are your buttons.
 *      A workflow change on the backend updates the UI automatically.
 *
 *   2. Note-required actions (REQUEST_INFO, APPROVE, REJECT) reveal a
 *      textarea on first click, then submit on the second. This avoids
 *      cluttering the panel with N forms and prevents "oops clicked
 *      Reject" mistakes.
 *
 *   3. On 409 CONCURRENT_MODIFICATION we don't show an error toast.
 *      We refetch the detail + available-actions. The UI re-renders
 *      with the now-current state — exactly the page the user should've
 *      seen — and we show a yellow banner explaining what happened.
 */

const LABEL: Record<WorkflowAction, string> = {
  SUBMIT: 'Submit application',
  START_REVIEW: 'Start review',
  REQUEST_INFO: 'Request more info',
  RESUBMIT: 'Resubmit',
  APPROVE: 'Approve',
  REJECT: 'Reject',
};

const PATH: Record<WorkflowAction, string> = {
  SUBMIT: 'submit',
  START_REVIEW: 'start-review',
  REQUEST_INFO: 'request-info',
  RESUBMIT: 'resubmit',
  APPROVE: 'approve',
  REJECT: 'reject',
};

const NEEDS_NOTE: ReadonlySet<WorkflowAction> = new Set([
  'REQUEST_INFO', 'APPROVE', 'REJECT',
]);

const NOTE_PROMPT: Partial<Record<WorkflowAction, string>> = {
  REQUEST_INFO: 'What information does the applicant need to provide? (≥ 10 chars)',
  APPROVE: 'Reason for approval (will be saved on the application). (≥ 10 chars)',
  REJECT: 'Reason for rejection (will be saved on the application). (≥ 10 chars)',
};

export function ApplicationActions({ applicationId }: { applicationId: string }) {
  const qc = useQueryClient();

  const { data: avail, isLoading } = useQuery<AvailableActionsResponse>({
    queryKey: queryKeys.applications.actions(applicationId),
    queryFn: () =>
      api<AvailableActionsResponse>(`/applications/${applicationId}/available-actions`),
  });

  const [pending, setPending] = useState<WorkflowAction | null>(null);
  const [note, setNote] = useState('');
  const [staleBanner, setStaleBanner] = useState(false);

  const mutation = useMutation({
    mutationFn: async (action: WorkflowAction) => {
      if (!avail) throw new Error('Available actions not loaded yet');
      const body: Record<string, unknown> = { expectedVersion: avail.version };
      if (NEEDS_NOTE.has(action)) body.note = note;
      return api(`/applications/${applicationId}/${PATH[action]}`, {
        method: 'POST',
        body,
      });
    },
    onSuccess: () => {
      // Surgical invalidation: detail + actions changed; list view rows
      // also reflect new state; audit will include the new event.
      qc.invalidateQueries({
        queryKey: queryKeys.applications.detail(applicationId),
      });
      qc.invalidateQueries({
        queryKey: queryKeys.applications.actions(applicationId),
      });
      qc.invalidateQueries({ queryKey: queryKeys.applications.all });
      setPending(null);
      setNote('');
      setStaleBanner(false);
    },
    onError: (err) => {
      if (
        err instanceof ApiError &&
        (err.code === 'CONCURRENT_MODIFICATION' ||
         err.code === 'ILLEGAL_STATE_TRANSITION')
      ) {
        // Both signal "this changed under you." Refetch and let the
        // user decide what to do from the new state.
        setStaleBanner(true);
        qc.invalidateQueries({
          queryKey: queryKeys.applications.detail(applicationId),
        });
        qc.invalidateQueries({
          queryKey: queryKeys.applications.actions(applicationId),
        });
      }
    },
  });

  if (isLoading || !avail) return null;
  if (avail.isTerminal) {
    return (
      <p className="text-sm text-gray-500">
        This application is in a final state. No further actions are possible.
      </p>
    );
  }
  if (avail.actions.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No actions available to you on this application right now.
      </p>
    );
  }

  const showNoteField = pending && NEEDS_NOTE.has(pending);
  const noteOk = !showNoteField || note.length >= 10;

  return (
    <section className="rounded border border-gray-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-900">Actions</h2>

      {staleBanner && (
        <div className="mb-3 rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
          This application was changed by someone else. The page has been
          refreshed with the latest state — please review and try again.
        </div>
      )}

      {showNoteField && (
        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-700">
            {NOTE_PROMPT[pending!]}
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            minLength={10}
            rows={3}
            className="mt-1 block w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-1 text-[10px] text-gray-500">
            {note.length} / 10 minimum characters
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {avail.actions.map((action) => {
          const isDestructive = action === 'REJECT';
          const armed = pending === action;
          const disabled =
            mutation.isPending || (armed && NEEDS_NOTE.has(action) && !noteOk);
          return (
            <button
              key={action}
              disabled={disabled}
              onClick={() => {
                if (NEEDS_NOTE.has(action) && !armed) {
                  setPending(action);
                  setNote('');
                  return;
                }
                if (armed && !noteOk) return;
                mutation.mutate(action);
              }}
              className={`rounded px-3 py-1.5 text-sm font-medium shadow-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                isDestructive
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : armed
                    ? 'bg-blue-700 text-white hover:bg-blue-800'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {armed && NEEDS_NOTE.has(action) ? `Confirm ${LABEL[action]}` : LABEL[action]}
            </button>
          );
        })}
        {pending && (
          <button
            onClick={() => {
              setPending(null);
              setNote('');
            }}
            className="rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
        )}
      </div>

      {mutation.error && mutation.error instanceof ApiError &&
        mutation.error.code !== 'CONCURRENT_MODIFICATION' &&
        mutation.error.code !== 'ILLEGAL_STATE_TRANSITION' && (
        <p className="mt-3 text-xs text-red-700">{mutation.error.message}</p>
      )}
    </section>
  );
}
