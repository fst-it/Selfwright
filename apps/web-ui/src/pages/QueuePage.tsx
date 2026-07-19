import { useState } from "react";
import {
  QueueResponseSchema,
  PromoteQueueEntryResponseSchema,
  DismissQueueEntryResponseSchema,
  type QueueEntryContract,
} from "@selfwright/api-contract";
import { useApiQuery } from "../lib/use-api-query.js";
import { useTableDensity } from "../lib/use-table-density.js";
import { useCsrfToken } from "../lib/auth-context.js";
import { writeJson, ApiError } from "../lib/api.js";
import { Card, CardContent } from "../components/ui/card.js";
import { Button } from "../components/ui/button.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import { Loading, ErrorBanner, Empty } from "../components/Status.js";

type PendingAction = { kind: "promote" | "dismiss"; entry: QueueEntryContract } | null;

function QueueActionDialog({
  action,
  csrfToken,
  contentHash,
  onClose,
  onDone,
}: {
  action: NonNullable<PendingAction>;
  csrfToken: string;
  contentHash: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { kind, entry } = action;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      if (kind === "promote") {
        await writeJson(
          `/api/queue/${encodeURIComponent(entry.id)}/promote`,
          "POST",
          csrfToken,
          { contentHash },
          PromoteQueueEntryResponseSchema,
        );
      } else {
        await writeJson(
          `/api/queue/${encodeURIComponent(entry.id)}/dismiss`,
          "POST",
          csrfToken,
          {},
          DismissQueueEntryResponseSchema,
        );
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{kind === "promote" ? "Promote to application" : "Dismiss queue entry"}</DialogTitle>
          <DialogDescription>
            {entry.company} — {entry.derived_role ?? "Unknown role"}
            {kind === "promote"
              ? ". Creates a new application (status “evaluating”) and removes this entry from the queue."
              : ". Removes this entry from the queue. It will not resurface — the scanner already remembers this posting was seen, whether or not it stays in the queue."}
          </DialogDescription>
        </DialogHeader>
        {error !== null ? <ErrorBanner message={error} /> : null}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={kind === "dismiss" ? "destructive" : "default"}
            size="sm"
            onClick={() => void confirm()}
            disabled={busy}
          >
            {busy ? "Working…" : kind === "promote" ? "Confirm promote" : "Confirm dismiss"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function QueuePage() {
  const query = useApiQuery("/api/queue", QueueResponseSchema);
  const csrfToken = useCsrfToken();
  const [pending, setPending] = useState<PendingAction>(null);
  const density = useTableDensity();

  if (query.status === "loading") return <Loading label="queue" />;
  if (query.status === "error") return <ErrorBanner message={query.message} />;

  const { active, staleCount, agingWindowDays, contentHash } = query.data;
  const sorted = [...active].sort((a, b) => (b.fit_score ?? -Infinity) - (a.fit_score ?? -Infinity));

  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-xl font-semibold">Queue</h1>
      <h2 className="text-sm font-semibold text-muted">
        {active.length} active
        {staleCount > 0 ? `, ${String(staleCount)} stale (hidden, older than ${String(agingWindowDays)} days)` : ""}
      </h2>

      {active.length === 0 ? (
        <Empty>Queue is empty.</Empty>
      ) : (
        <div data-density={density}>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Fit score</TableHead>
                  {csrfToken !== null ? <TableHead>Actions</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{entry.company}</TableCell>
                    <TableCell>{entry.derived_role ?? "—"}</TableCell>
                    <TableCell>{entry.fit_score !== undefined && entry.fit_score !== null ? entry.fit_score.toFixed(1) : "—"}</TableCell>
                    {csrfToken !== null ? (
                      <TableCell>
                        <div className="flex gap-1.5">
                          <Button size="sm" onClick={() => { setPending({ kind: "promote", entry }); }}>
                            Promote
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { setPending({ kind: "dismiss", entry }); }}
                          >
                            Dismiss
                          </Button>
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        </div>
      )}

      {pending !== null && csrfToken !== null ? (
        <QueueActionDialog
          action={pending}
          csrfToken={csrfToken}
          contentHash={contentHash}
          onClose={() => { setPending(null); }}
          onDone={() => {
            setPending(null);
            query.refetch();
          }}
        />
      ) : null}
    </div>
  );
}
