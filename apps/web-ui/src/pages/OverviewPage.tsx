import { OverviewResponseSchema } from "@selfwright/api-contract";
import { useApiQuery } from "../lib/use-api-query.js";
import { Card, CardContent } from "../components/ui/card.js";
import { Loading, ErrorBanner } from "../components/Status.js";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="pt-4 text-center">
        <div className="text-3xl font-bold text-foreground">{value}</div>
        <div className="mt-1 text-xs text-muted">{label}</div>
      </CardContent>
    </Card>
  );
}

export default function OverviewPage() {
  const query = useApiQuery("/api/overview", OverviewResponseSchema);

  if (query.status === "loading") return <Loading label="overview" />;
  if (query.status === "error") return <ErrorBanner message={query.message} />;

  const { northStar, fitnessHistory, inbox, digestCount } = query.data;
  const lastRun = fitnessHistory[fitnessHistory.length - 1];
  const recent = fitnessHistory.slice(-10);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Overview</h1>

      <section aria-labelledby="north-star-heading">
        <h2 id="north-star-heading" className="mb-2 text-sm font-semibold text-muted">
          North-Star
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Submitted" value={northStar.submitted} />
          <Stat label="Interviews" value={northStar.interviews} />
          <Stat label="Per 10 apps" value={northStar.ratePerTen !== null ? northStar.ratePerTen.toFixed(2) : "—"} />
        </div>
      </section>

      <section aria-labelledby="fitness-heading">
        <h2 id="fitness-heading" className="mb-2 text-sm font-semibold text-muted">
          Fitness
        </h2>
        <Card>
          <CardContent className="pt-4">
            {fitnessHistory.length === 0 || lastRun === undefined ? (
              <p className="text-sm italic text-muted">No fitness history available.</p>
            ) : (
              <>
                <p className="mb-2 text-sm">
                  Last run:{" "}
                  {/* text-success (not text-primary): matches the pass/fail color convention the
                      sparkline bars below use, and passes WCAG AA where text-primary measured under it. */}
                  <span className={lastRun.failed > 0 ? "text-destructive" : "text-success"}>
                    {lastRun.failed > 0 ? `${String(lastRun.failed)} failed` : `${String(lastRun.passed)} passed / ${String(lastRun.skipped)} skipped`}
                  </span>{" "}
                  <span className="text-xs text-muted">{lastRun.runAt.slice(0, 10)}</span>
                </p>
                <svg viewBox={`0 0 200 40`} width={200} height={40} aria-label="Fitness history sparkline (last 10 runs)" role="img">
                  {recent.map((run, i) => (
                    <rect
                      key={String(i)}
                      x={i * (Math.floor(200 / recent.length) - 1 + 1)}
                      y={0}
                      width={Math.floor(200 / recent.length) - 1}
                      height={40}
                      fill={run.failed > 0 ? "#DC4C4C" : "#22C55E"}
                      opacity={0.85}
                    />
                  ))}
                </svg>
              </>
            )}
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="inbox-heading">
        <h2 id="inbox-heading" className="mb-2 text-sm font-semibold text-muted">
          Inbox Summary
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Decide-now" value={inbox.decideNow} />
          <Stat label="Review-soon" value={inbox.reviewSoon} />
          <Stat label="FYI" value={inbox.fyi} />
          <Stat label="Digests" value={digestCount} />
        </div>
      </section>
    </div>
  );
}
