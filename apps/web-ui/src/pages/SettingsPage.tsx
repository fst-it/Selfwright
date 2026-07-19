import { useState } from "react";
import {
  SettingsContractSchema,
  SettingsUpdateResponseSchema,
  ScanTargetsContractSchema,
  ScanTargetsUpdateResponseSchema,
} from "@selfwright/api-contract";
import type { ScanTargetConfig } from "@selfwright/api-contract";
import { useApiQuery } from "../lib/use-api-query.js";
import { useCsrfToken } from "../lib/auth-context.js";
import { writeJson, ApiError } from "../lib/api.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import { Select } from "../components/ui/select.js";
import { Loading, ErrorBanner } from "../components/Status.js";

// ── Per-section override state ────────────────────────────────────────────────
// null = "not yet touched — use the loaded value"; non-null once the user edits.
// This lets the form show the API value before any changes, and track only
// what the owner has actually modified.
type SettingsOverrides = {
  agingWindowDays: string | null;
  fitScoreCutoff: string | null;
  interviewStaleDays: string | null;
  appliedReviewDays: string | null;
  appliedDecideDays: string | null;
  ntfyTopic: string | null;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  enabledInboxDigest: boolean | null;
  enabledScanDigest: boolean | null;
  scheduleDay: string | null;
  scheduleHour: string | null;
  scanVerify: boolean | null;
  coachingArchetype: string | null;
  debriefNudgeDays: string | null;
  drillCadenceDays: string | null;
  dashboardTheme: string | null;
  dashboardLandingPage: string | null;
  dashboardTableDensity: string | null;
};

function emptyOverrides(): SettingsOverrides {
  return {
    agingWindowDays: null, fitScoreCutoff: null, interviewStaleDays: null,
    appliedReviewDays: null, appliedDecideDays: null, ntfyTopic: null,
    quietHoursStart: null, quietHoursEnd: null, enabledInboxDigest: null, enabledScanDigest: null,
    scheduleDay: null,
    scheduleHour: null, scanVerify: null, coachingArchetype: null,
    debriefNudgeDays: null, drillCadenceDays: null, dashboardTheme: null,
    dashboardLandingPage: null, dashboardTableDensity: null,
  };
}

function intField(val: string | null | undefined, def: number): number {
  const n = Number(val ?? def);
  return Number.isInteger(n) && n >= 0 ? n : def;
}

function floatField(val: string | null | undefined, def: number): number {
  const n = parseFloat(String(val ?? def));
  return isFinite(n) && n >= 0 && n <= 5 ? n : def;
}

export default function SettingsPage() {
  const query = useApiQuery("/api/settings", SettingsContractSchema);
  const targetsQuery = useApiQuery("/api/scan-targets", ScanTargetsContractSchema);
  const csrfToken = useCsrfToken();

  const [ov, setOv] = useState<SettingsOverrides>(emptyOverrides());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedSettings, setSavedSettings] = useState(false);

  // Scan-targets local state: mirror loaded targets; allow toggling disabled.
  const [targetOverrides, setTargetOverrides] = useState<Map<number, Partial<ScanTargetConfig>>>(new Map());
  const [savingTargets, setSavingTargets] = useState(false);
  const [targetsError, setTargetsError] = useState<string | null>(null);
  const [savedTargets, setSavedTargets] = useState(false);

  if (query.status === "loading" || targetsQuery.status === "loading") return <Loading label="settings" />;
  if (query.status === "error") return <ErrorBanner message={query.message} />;
  if (targetsQuery.status === "error") return <ErrorBanner message={targetsQuery.message} />;

  const s = query.data;
  const loadedTargets = targetsQuery.data.targets;

  // ── Effective values (override ?? loaded ?? default) ────────────────────────
  const agingWindowDays = ov.agingWindowDays ?? String(s.queue?.aging_window_days ?? 30);
  const fitScoreCutoff  = ov.fitScoreCutoff  ?? String(s.queue?.fit_score_cutoff_review_soon ?? 3.5);
  const interviewStaleDays  = ov.interviewStaleDays  ?? String(s.inbox?.interview_stale_days  ?? 7);
  const appliedReviewDays   = ov.appliedReviewDays   ?? String(s.inbox?.applied_review_days   ?? 14);
  const appliedDecideDays   = ov.appliedDecideDays   ?? String(s.inbox?.applied_decide_days   ?? 21);
  const ntfyTopic        = ov.ntfyTopic        ?? (s.notifications?.ntfy_topic        ?? "");
  const quietHoursStart  = ov.quietHoursStart  ?? String(s.notifications?.quiet_hours?.start ?? "");
  const quietHoursEnd    = ov.quietHoursEnd    ?? String(s.notifications?.quiet_hours?.end   ?? "");
  const loadedEnabledDigests = s.notifications?.enabled_digests;
  const enabledInboxDigest = ov.enabledInboxDigest ?? (loadedEnabledDigests === undefined ? true : loadedEnabledDigests.includes("inbox"));
  const enabledScanDigest  = ov.enabledScanDigest  ?? (loadedEnabledDigests === undefined ? true : loadedEnabledDigests.includes("scan"));
  const scheduleDay      = ov.scheduleDay      ?? (s.scan?.schedule?.day   ?? "Sunday");
  const scheduleHour     = ov.scheduleHour     ?? String(s.scan?.schedule?.hour ?? 9);
  const scanVerify       = ov.scanVerify       ?? (s.scan?.verify ?? false);
  const coachingArchetype = ov.coachingArchetype ?? (s.coaching?.default_archetype ?? "");
  const debriefNudgeDays  = ov.debriefNudgeDays  ?? String(s.coaching?.debrief_nudge_days ?? 0);
  const drillCadenceDays  = ov.drillCadenceDays  ?? String(s.coaching?.drill_cadence_days ?? 0);
  const dashboardTheme        = ov.dashboardTheme        ?? (s.dashboard?.theme         ?? "system");
  const dashboardLandingPage  = ov.dashboardLandingPage  ?? (s.dashboard?.landing_page   ?? "overview");
  const dashboardTableDensity = ov.dashboardTableDensity ?? (s.dashboard?.table_density  ?? "comfortable");

  // ── Save settings.yml ────────────────────────────────────────────────────────
  async function saveSettings() {
    if (csrfToken === null) return;
    // Client-side validation: aging window must be a positive integer.
    const agingWindowParsed = Number(agingWindowDays);
    if (!Number.isInteger(agingWindowParsed) || agingWindowParsed <= 0) {
      setSaveError("Queue aging window must be a positive integer");
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSavedSettings(false);
    try {
      const quietHoursStartN = quietHoursStart.trim() !== "" ? parseInt(quietHoursStart, 10) : undefined;
      const quietHoursEndN   = quietHoursEnd.trim()   !== "" ? parseInt(quietHoursEnd, 10)   : undefined;
      const body = {
        queue: {
          aging_window_days: agingWindowParsed,
          fit_score_cutoff_review_soon: floatField(fitScoreCutoff, 3.5) !== 3.5
            ? floatField(fitScoreCutoff, 3.5) : undefined,
        },
        inbox: {
          interview_stale_days: intField(interviewStaleDays, 7) !== 7
            ? intField(interviewStaleDays, 7) : undefined,
          applied_review_days: intField(appliedReviewDays, 14) !== 14
            ? intField(appliedReviewDays, 14) : undefined,
          applied_decide_days: intField(appliedDecideDays, 21) !== 21
            ? intField(appliedDecideDays, 21) : undefined,
        },
        notifications: {
          ntfy_topic: ntfyTopic.trim() !== "" ? ntfyTopic.trim() : undefined,
          quiet_hours: quietHoursStartN !== undefined && quietHoursEndN !== undefined
            ? { start: quietHoursStartN, end: quietHoursEndN } : undefined,
          enabled_digests: (!enabledInboxDigest || !enabledScanDigest)
            ? [
                ...(enabledInboxDigest ? ["inbox"] : []),
                ...(enabledScanDigest ? ["scan"] : []),
              ]
            : undefined,
        },
        scan: {
          schedule: {
            day: scheduleDay !== "Sunday" ? scheduleDay : undefined,
            hour: intField(scheduleHour, 9) !== 9 ? intField(scheduleHour, 9) : undefined,
          },
          verify: scanVerify || undefined,
        },
        coaching: {
          default_archetype: coachingArchetype.trim() !== "" ? coachingArchetype.trim() : undefined,
          debrief_nudge_days: intField(debriefNudgeDays, 0) !== 0
            ? intField(debriefNudgeDays, 0) : undefined,
          drill_cadence_days: intField(drillCadenceDays, 0) !== 0
            ? intField(drillCadenceDays, 0) : undefined,
        },
        dashboard: {
          theme: dashboardTheme !== "system" ? dashboardTheme : undefined,
          landing_page: dashboardLandingPage !== "overview" ? dashboardLandingPage : undefined,
          table_density: dashboardTableDensity !== "comfortable" ? dashboardTableDensity : undefined,
        },
      };
      await writeJson("/api/settings", "PUT", csrfToken, body, SettingsUpdateResponseSchema);
      setSavedSettings(true);
      setOv(emptyOverrides());
      query.refetch();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  // ── Save scan-targets ────────────────────────────────────────────────────────
  async function saveTargets() {
    if (csrfToken === null) return;
    setSavingTargets(true);
    setTargetsError(null);
    setSavedTargets(false);
    try {
      const targets = loadedTargets.map((t, i) => {
        const ovt = targetOverrides.get(i);
        return ovt !== undefined ? { ...t, ...ovt } : t;
      });
      await writeJson("/api/scan-targets", "PUT", csrfToken, { targets }, ScanTargetsUpdateResponseSchema);
      setSavedTargets(true);
      setTargetOverrides(new Map());
      targetsQuery.refetch();
    } catch (err) {
      setTargetsError(err instanceof ApiError ? err.message : "Failed to save scan targets");
    } finally {
      setSavingTargets(false);
    }
  }

  function toggleDisabled(idx: number) {
    setTargetOverrides((prev) => {
      const next = new Map(prev);
      const currentTarget = loadedTargets[idx];
      const prevOv = prev.get(idx) ?? {};
      const currentDisabled = prevOv.disabled ?? currentTarget?.disabled ?? false;
      next.set(idx, { ...prevOv, disabled: !currentDisabled });
      return next;
    });
  }

  // ── Section helper to reduce JSX repetition ─────────────────────────────────
  function numInput(
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    min = 0,
  ) {
    return (
      <div>
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id}
          type="number"
          min={min}
          step={1}
          value={value}
          onChange={(e) => { onChange(e.target.value); }}
          className="mt-1 w-28"
        />
      </div>
    );
  }

  const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const PAGES = ["overview","inbox","pipeline","queue","coaching","content","reporting","settings"];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Settings</h1>

      {/* ── Queue ── */}
      <Card>
        <CardHeader><CardTitle className="text-foreground">Queue</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          {numInput("aging-window", "Aging window (days before a queue entry is stale)", agingWindowDays, (v) => { setOv((p) => ({ ...p, agingWindowDays: v })); }, 1)}
          {numInput("fit-cutoff", "Fit-score cutoff for review-soon tier (0–5)", fitScoreCutoff, (v) => { setOv((p) => ({ ...p, fitScoreCutoff: v })); })}
        </CardContent>
      </Card>

      {/* ── Inbox staleness ── */}
      <Card>
        <CardHeader><CardTitle className="text-foreground">Inbox staleness thresholds</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          {numInput("interview-stale", "Interview stale after (days)", interviewStaleDays, (v) => { setOv((p) => ({ ...p, interviewStaleDays: v })); }, 1)}
          {numInput("applied-review", "Applied — review after (days)", appliedReviewDays, (v) => { setOv((p) => ({ ...p, appliedReviewDays: v })); }, 1)}
          {numInput("applied-decide", "Applied — decide after (days)", appliedDecideDays, (v) => { setOv((p) => ({ ...p, appliedDecideDays: v })); }, 1)}
        </CardContent>
      </Card>

      {/* ── Notifications ── */}
      <Card>
        <CardHeader><CardTitle className="text-foreground">Notifications</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div>
            <Label htmlFor="ntfy-topic">ntfy topic URL (overrides NTFY_URL env var)</Label>
            <Input id="ntfy-topic" type="url" value={ntfyTopic} placeholder="https://ntfy.example.com/mytopic"
              onChange={(e) => { setOv((p) => ({ ...p, ntfyTopic: e.target.value })); }}
              className="mt-1" />
          </div>
          <div className="flex gap-4">
            {numInput("quiet-start", "Quiet hours start (0–23)", quietHoursStart, (v) => { setOv((p) => ({ ...p, quietHoursStart: v })); })}
            {numInput("quiet-end", "Quiet hours end (0–23, exclusive)", quietHoursEnd, (v) => { setOv((p) => ({ ...p, quietHoursEnd: v })); })}
          </div>
          <div className="flex flex-col gap-1">
            <Label>Enabled digest notifications</Label>
            <div className="flex items-center gap-2">
              <input id="digest-inbox" type="checkbox" checked={enabledInboxDigest}
                onChange={(e) => { setOv((p) => ({ ...p, enabledInboxDigest: e.target.checked })); }} />
              <Label htmlFor="digest-inbox">Inbox digest</Label>
            </div>
            <div className="flex items-center gap-2">
              <input id="digest-scan" type="checkbox" checked={enabledScanDigest}
                onChange={(e) => { setOv((p) => ({ ...p, enabledScanDigest: e.target.checked })); }} />
              <Label htmlFor="digest-scan">Scan digest</Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Scan schedule ── */}
      <Card>
        <CardHeader><CardTitle className="text-foreground">Scan schedule</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div>
            <Label htmlFor="scan-day">Scan day of week</Label>
            <Select id="scan-day" value={scheduleDay}
              onChange={(e) => { setOv((p) => ({ ...p, scheduleDay: e.target.value })); }}
              className="mt-1 w-44">
              {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
            </Select>
          </div>
          {numInput("scan-hour", "Scan hour (0–23, 24-hour clock)", scheduleHour, (v) => { setOv((p) => ({ ...p, scheduleHour: v })); })}
          <div className="flex items-center gap-2">
            <input id="scan-verify" type="checkbox" checked={scanVerify}
              onChange={(e) => { setOv((p) => ({ ...p, scanVerify: e.target.checked })); }} />
            <Label htmlFor="scan-verify">Enable browser verify (re-check uncertain postings with Chromium)</Label>
          </div>
          <p className="text-xs text-muted">
            Schedule changes take effect only after reinstalling the Windows Scheduled Tasks
            by re-running <code>tools/scripts/install-scheduled-tasks.ps1</code>.
          </p>
        </CardContent>
      </Card>

      {/* ── Coaching ── */}
      <Card>
        <CardHeader><CardTitle className="text-foreground">Coaching</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div>
            <Label htmlFor="coaching-archetype">Default archetype ID (used by inbox when --archetype not supplied)</Label>
            <Input id="coaching-archetype" type="text" value={coachingArchetype} placeholder="data-engineering"
              onChange={(e) => { setOv((p) => ({ ...p, coachingArchetype: e.target.value })); }}
              className="mt-1 w-64" />
          </div>
          {numInput("debrief-nudge", "Debrief nudge window (days; 0 = disabled)", debriefNudgeDays, (v) => { setOv((p) => ({ ...p, debriefNudgeDays: v })); })}
          {numInput("drill-cadence", "Drill cadence (days between drill FYIs; 0 = disabled)", drillCadenceDays, (v) => { setOv((p) => ({ ...p, drillCadenceDays: v })); })}
        </CardContent>
      </Card>

      {/* ── Dashboard prefs ── */}
      <Card>
        <CardHeader><CardTitle className="text-foreground">Dashboard preferences</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div>
            <Label htmlFor="dash-theme">Theme</Label>
            <Select id="dash-theme" value={dashboardTheme}
              onChange={(e) => { setOv((p) => ({ ...p, dashboardTheme: e.target.value })); }}
              className="mt-1 w-36">
              {["system","light","dark"].map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="dash-landing">Landing page</Label>
            <Select id="dash-landing" value={dashboardLandingPage}
              onChange={(e) => { setOv((p) => ({ ...p, dashboardLandingPage: e.target.value })); }}
              className="mt-1 w-44">
              {PAGES.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="dash-density">Table density</Label>
            <Select id="dash-density" value={dashboardTableDensity}
              onChange={(e) => { setOv((p) => ({ ...p, dashboardTableDensity: e.target.value })); }}
              className="mt-1 w-44">
              {["comfortable","compact"].map((d) => <option key={d} value={d}>{d}</option>)}
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* ── Save settings ── */}
      <div className="flex items-center gap-3">
        <Button onClick={() => void saveSettings()} disabled={saving || csrfToken === null}>
          {saving ? "Saving…" : "Save"}
        </Button>
        {saveError !== null ? <ErrorBanner message={saveError} /> : null}
        {savedSettings ? <p className="text-sm text-success">Settings saved.</p> : null}
      </div>

      {/* ── Scan targets ── */}
      <Card>
        <CardHeader><CardTitle className="text-foreground">Scan targets</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          {loadedTargets.length === 0 ? (
            <p className="text-sm text-muted">No scan targets configured in pipeline/scan-targets.yml.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted">
                    <th className="py-1 pr-4 font-medium">Company</th>
                    <th className="py-1 pr-4 font-medium">Provider</th>
                    <th className="py-1 pr-4 font-medium">Disabled</th>
                  </tr>
                </thead>
                <tbody>
                  {loadedTargets.map((t, i) => {
                    const ovt = targetOverrides.get(i);
                    const isDisabled = ovt?.disabled ?? t.disabled ?? false;
                    return (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-1 pr-4">{t.company}</td>
                        <td className="py-1 pr-4">{t.provider}</td>
                        <td className="py-1 pr-4">
                          <input
                            type="checkbox"
                            aria-label={`Disable ${t.company}`}
                            checked={isDisabled}
                            onChange={() => { toggleDisabled(i); }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              onClick={() => void saveTargets()}
              disabled={savingTargets || csrfToken === null || targetOverrides.size === 0}
            >
              {savingTargets ? "Saving…" : "Save targets"}
            </Button>
            {targetsError !== null ? <ErrorBanner message={targetsError} /> : null}
            {savedTargets ? <p className="text-sm text-success">Scan targets saved.</p> : null}
          </div>
        </CardContent>
      </Card>

      {/* ── Raw settings document (read-only) ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Full settings document (read-only)</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="overflow-auto rounded-md bg-background p-3 text-xs text-foreground">
            {JSON.stringify(s, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
