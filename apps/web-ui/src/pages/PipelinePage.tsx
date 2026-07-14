import { useState } from "react";
import {
  ApplicationsListResponseSchema,
  StatusUpdateResponseSchema,
  type ApplicationRecordContract,
} from "@selfwright/api-contract";
import { useApiQuery } from "../lib/use-api-query.js";
import { useTableDensity } from "../lib/use-table-density.js";
import { useCsrfToken } from "../lib/auth-context.js";
import { writeJson, ApiError } from "../lib/api.js";
import { Card, CardContent } from "../components/ui/card.js";
import { Badge } from "../components/ui/badge.js";
import { Select } from "../components/ui/select.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import { Button } from "../components/ui/button.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table.js";
import { Loading, ErrorBanner, Empty } from "../components/Status.js";

// Same canonical vocabulary as packages/core's APPLICATION_STATUSES — kept as
// a literal list here (not imported) because apps/web-ui never imports
// @selfwright/core directly (cockpit consumes ONLY /api/*).
const APPLICATION_STATUSES = [
  "discovered",
  "evaluating",
  "ready",
  "outreach",
  "applied",
  "screen",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
  "skipped",
] as const;

const STATUS_ORDER: Record<string, number> = {
  offer: 0,
  interview: 1,
  screen: 2,
  applied: 3,
  outreach: 4,
  ready: 5,
  evaluating: 6,
  discovered: 7,
  rejected: 8,
  withdrawn: 9,
  skipped: 10,
};

function statusBadgeVariant(status: string): "destructive" | "warning" | "default" {
  if (status === "offer" || status === "interview") return "destructive";
  if (["screen", "applied", "outreach", "ready", "evaluating", "discovered"].includes(status)) return "warning";
  return "default";
}

function StatusRow({
  app,
  contentHash,
  csrfToken,
  onSaved,
}: {
  app: ApplicationRecordContract;
  contentHash: string;
  csrfToken: string;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState(app.status);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await writeJson(
        `/api/applications/${encodeURIComponent(app.id)}/status`,
        "POST",
        csrfToken,
        { status, note: note.length > 0 ? note : undefined, contentHash },
        StatusUpdateResponseSchema,
      );
      setNote("");
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <TableRow>
      <TableCell>{app.company}</TableCell>
      <TableCell>{app.role}</TableCell>
      <TableCell>
        <Badge variant={statusBadgeVariant(app.status)}>{app.status}</Badge>
      </TableCell>
      <TableCell>{app.dates.applied ?? "—"}</TableCell>
      <TableCell>{app.dates.last_update ?? "—"}</TableCell>
      <TableCell>{app.notes ?? "—"}</TableCell>
      <TableCell>
        <form
          className="flex flex-wrap items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Label htmlFor={`status-${app.id}`} className="sr-only">
            New status for {app.company} — {app.role}
          </Label>
          <Select
            id={`status-${app.id}`}
            value={status}
            onChange={(e) => { setStatus(e.target.value); }}
            className="h-8 text-xs"
          >
            {APPLICATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <Input
            aria-label={`Note for ${app.company} — ${app.role}`}
            placeholder="note (optional)"
            maxLength={500}
            value={note}
            onChange={(e) => { setNote(e.target.value); }}
            className="h-8 w-28 text-xs"
          />
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          {error !== null ? <span className="text-xs text-destructive">{error}</span> : null}
        </form>
      </TableCell>
    </TableRow>
  );
}

export default function PipelinePage() {
  const query = useApiQuery("/api/applications", ApplicationsListResponseSchema);
  const csrfToken = useCsrfToken();
  const density = useTableDensity();

  if (query.status === "loading") return <Loading label="pipeline" />;
  if (query.status === "error") return <ErrorBanner message={query.message} />;

  const { applications, contentHash } = query.data;
  const sorted = [...applications].sort((a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99));

  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-xl font-semibold">Pipeline</h1>
      <h2 className="text-sm font-semibold text-muted">Applications ({applications.length})</h2>
      {applications.length === 0 ? (
        <Empty>No applications recorded.</Empty>
      ) : (
        <div data-density={density}>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Applied</TableHead>
                  <TableHead>Last update</TableHead>
                  <TableHead>Notes</TableHead>
                  {contentHash !== null && csrfToken !== null ? <TableHead>Update status</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((app) =>
                  contentHash !== null && csrfToken !== null ? (
                    <StatusRow
                      key={app.id}
                      app={app}
                      contentHash={contentHash}
                      csrfToken={csrfToken}
                      onSaved={query.refetch}
                    />
                  ) : (
                    <TableRow key={app.id}>
                      <TableCell>{app.company}</TableCell>
                      <TableCell>{app.role}</TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(app.status)}>{app.status}</Badge>
                      </TableCell>
                      <TableCell>{app.dates.applied ?? "—"}</TableCell>
                      <TableCell>{app.dates.last_update ?? "—"}</TableCell>
                      <TableCell>{app.notes ?? "—"}</TableCell>
                    </TableRow>
                  ),
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        </div>
      )}
    </div>
  );
}
