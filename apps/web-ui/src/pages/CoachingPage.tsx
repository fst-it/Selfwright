import { useState } from "react";
import { CoachingResponseSchema, DebriefCreateResponseSchema } from "@selfwright/api-contract";
import { useApiQuery } from "../lib/use-api-query.js";
import { useCsrfToken } from "../lib/auth-context.js";
import { writeJson, ApiError } from "../lib/api.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import { Textarea } from "../components/ui/textarea.js";
import { Loading, ErrorBanner, Empty } from "../components/Status.js";

function parseLines(raw: string): string[] {
  return raw
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function DebriefForm({ csrfToken, onSaved }: { csrfToken: string; onSaved: () => void }) {
  const [applicationId, setApplicationId] = useState("");
  const [date, setDate] = useState("");
  const [round, setRound] = useState("");
  const [asked, setAsked] = useState("");
  const [wobbled, setWobbled] = useState("");
  const [wentWell, setWentWell] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await writeJson(
        "/api/debriefs",
        "POST",
        csrfToken,
        {
          application_id: applicationId,
          date,
          round: round.length > 0 ? round : undefined,
          asked: parseLines(asked).length > 0 ? parseLines(asked) : undefined,
          wobbled: parseLines(wobbled).length > 0 ? parseLines(wobbled) : undefined,
          went_well: parseLines(wentWell).length > 0 ? parseLines(wentWell) : undefined,
          notes: notes.length > 0 ? notes : undefined,
        },
        DebriefCreateResponseSchema,
      );
      setApplicationId("");
      setDate("");
      setRound("");
      setAsked("");
      setWobbled("");
      setWentWell("");
      setNotes("");
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save debrief");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-4">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div>
            <Label htmlFor="debrief-app">Application id</Label>
            <Input id="debrief-app" required maxLength={200} value={applicationId} onChange={(e) => { setApplicationId(e.target.value); }} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="debrief-date">Interview date</Label>
            <Input id="debrief-date" type="date" required value={date} onChange={(e) => { setDate(e.target.value); }} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="debrief-round">Round (optional)</Label>
            <Input id="debrief-round" maxLength={200} value={round} onChange={(e) => { setRound(e.target.value); }} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="debrief-asked">Asked (one topic per line)</Label>
            <Textarea id="debrief-asked" rows={3} value={asked} onChange={(e) => { setAsked(e.target.value); }} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="debrief-wobbled">Wobbled (one topic per line)</Label>
            <Textarea id="debrief-wobbled" rows={3} value={wobbled} onChange={(e) => { setWobbled(e.target.value); }} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="debrief-went-well">Went well (one topic per line)</Label>
            <Textarea id="debrief-went-well" rows={3} value={wentWell} onChange={(e) => { setWentWell(e.target.value); }} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="debrief-notes">Notes (no interviewer/person names — reference contacts instead)</Label>
            <Textarea id="debrief-notes" rows={3} value={notes} onChange={(e) => { setNotes(e.target.value); }} className="mt-1" />
          </div>
          {error !== null ? <ErrorBanner message={error} /> : null}
          <Button type="submit" disabled={saving} className="self-start">
            {saving ? "Saving…" : "Save debrief"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function CoachingPage() {
  const query = useApiQuery("/api/coaching", CoachingResponseSchema);
  const csrfToken = useCsrfToken();

  if (query.status === "loading") return <Loading label="coaching" />;
  if (query.status === "error") return <ErrorBanner message={query.message} />;

  const { debriefs, hasArchetype, nextDrill, drillFiles, prepPacks } = query.data;
  const recentDebriefs = [...debriefs].reverse().slice(0, 20);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Coaching</h1>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted">Log an interview debrief</h2>
        {csrfToken !== null ? (
          <DebriefForm csrfToken={csrfToken} onSaved={query.refetch} />
        ) : (
          <Loading label="session" />
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted">Recent Debriefs ({debriefs.length})</h2>
        {recentDebriefs.length === 0 ? (
          <Empty>No debriefs recorded yet.</Empty>
        ) : (
          <Card>
            <ul className="divide-y divide-border">
              {recentDebriefs.map((d, i) => (
                <li key={`${d.application_id}-${d.date}-${String(i)}`} className="p-3">
                  <div className="text-sm font-medium">
                    {d.application_id} — {d.date}
                    {d.round !== undefined ? ` (${d.round})` : ""}
                  </div>
                  {d.notes !== undefined ? <div className="mt-0.5 text-xs text-muted">{d.notes}</div> : null}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted">Next Drill</h2>
        {!hasArchetype ? (
          <Empty>No archetypes configured in data dir.</Empty>
        ) : nextDrill === null ? (
          <Empty>No drill candidates available.</Empty>
        ) : (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-foreground">
                {nextDrill.topicId}
                <Badge>{nextDrill.kind}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 text-sm text-muted">
              {nextDrill.gap !== undefined ? (
                <p>
                  Gap: {nextDrill.gap.title} — {nextDrill.gap.honest_gap}
                </p>
              ) : null}
              <p>{nextDrill.evidenceBundle.length} evidence entries available</p>
            </CardContent>
          </Card>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted">Drill History ({drillFiles.length} files)</h2>
        {drillFiles.length === 0 ? (
          <Empty>No drill files saved yet.</Empty>
        ) : (
          <ul className="list-inside list-disc text-sm">
            {drillFiles.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted">Prep Packs ({prepPacks.length})</h2>
        {prepPacks.length === 0 ? (
          <Empty>No prep packs saved yet.</Empty>
        ) : (
          <ul className="list-inside list-disc text-sm">
            {prepPacks.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
