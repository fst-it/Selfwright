import { ReportingResponseSchema } from "@selfwright/api-contract";
import { useApiQuery } from "../lib/use-api-query.js";
import { Card, CardContent } from "../components/ui/card.js";
import { Badge } from "../components/ui/badge.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table.js";
import { Loading, ErrorBanner, Empty } from "../components/Status.js";

// Not in SUBMITTED_STATUSES — mirrors packages/core's set without importing
// core directly (cockpit consumes only /api/*, see PipelinePage.tsx).
const SUBMITTED_STATUSES = new Set(["applied", "interview", "offer", "rejected", "withdrawn"]);

export default function ReportingPage() {
  const query = useApiQuery("/api/reporting", ReportingResponseSchema);

  if (query.status === "loading") return <Loading label="reporting" />;
  if (query.status === "error") return <ErrorBanner message={query.message} />;

  const { northStar, channelOutcomes, byStatus, fitnessHistory } = query.data;
  const recentRuns = [...fitnessHistory].slice(-20).reverse();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Reporting</h1>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted">North-Star Detail</h2>
        <Card>
          <CardContent className="pt-4">
            <Table>
              <TableBody>
                <TableRow>
                  <TableCell className="font-semibold">Total submitted</TableCell>
                  <TableCell>{northStar.submitted}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-semibold">Interviews / offers</TableCell>
                  <TableCell>{northStar.interviews}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-semibold">Rate per 10 apps</TableCell>
                  <TableCell>{northStar.ratePerTen !== null ? northStar.ratePerTen.toFixed(2) : "—"}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <h3 className="mb-1 mt-4 text-xs font-semibold text-muted">By status</h3>
            <Table>
              <TableBody>
                {Object.entries(byStatus).map(([status, count]) => (
                  <TableRow key={status}>
                    <TableCell>{status}</TableCell>
                    <TableCell>{count}</TableCell>
                    <TableCell>
                      {SUBMITTED_STATUSES.has(status) ? <Badge>counted</Badge> : <Badge variant="muted">pre-submit</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted">Channel → Outcome</h2>
        <Card>
          <CardContent className="pt-4">
            {channelOutcomes.length === 0 ? (
              <Empty>No submitted applications yet.</Empty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Channel</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead>Interviews</TableHead>
                    <TableHead>Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {channelOutcomes.map((co) => (
                    <TableRow key={co.channel}>
                      <TableCell>{co.channel}</TableCell>
                      <TableCell>{co.submitted}</TableCell>
                      <TableCell>{co.interviews}</TableCell>
                      <TableCell>{co.rate !== null ? `${(co.rate * 100).toFixed(0)}%` : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted">Fitness Trend</h2>
        {fitnessHistory.length === 0 ? (
          <Empty>No fitness history available.</Empty>
        ) : (
          <Card>
            <CardContent className="pt-4">
              <svg viewBox="0 0 300 30" width={300} height={30} aria-label="Fitness trend (last 20 runs)" role="img" className="mb-2 block">
                {[...fitnessHistory].slice(-20).map((run, i) => {
                  const recent = fitnessHistory.slice(-20);
                  const barW = Math.max(1, Math.floor(300 / recent.length) - 1);
                  return (
                    <rect
                      key={String(i)}
                      x={i * (barW + 1)}
                      y={0}
                      width={barW}
                      height={30}
                      fill={run.failed > 0 ? "#DC4C4C" : "#22C55E"}
                      opacity={0.85}
                    />
                  );
                })}
              </svg>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Run date</TableHead>
                    <TableHead>Passed</TableHead>
                    <TableHead>Skipped</TableHead>
                    <TableHead>Failed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentRuns.map((run, i) => (
                    <TableRow key={String(i)}>
                      <TableCell>{run.runAt.slice(0, 19).replace("T", " ")}</TableCell>
                      <TableCell className={run.failed > 0 ? "" : "font-semibold text-success"}>{run.passed}</TableCell>
                      <TableCell>{run.skipped}</TableCell>
                      <TableCell className={run.failed > 0 ? "font-semibold text-destructive" : ""}>{run.failed}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted">BI Tools</h2>
        <Card>
          <CardContent className="flex flex-col gap-2 pt-4 text-sm">
            <p>
              <a href="http://localhost:3000" className="text-link hover:underline">
                Metabase (localhost:3000)
              </a>{" "}
              <span className="text-xs italic text-muted">— dev machine / LAN only</span>
            </p>
            <p>
              <a href="http://localhost:3001" className="text-link hover:underline">
                Evidence (localhost:3001)
              </a>{" "}
              <span className="text-xs italic text-muted">— dev machine / LAN only</span>
            </p>
            <p className="text-xs italic text-muted">
              These links resolve only when running on the dev machine or LAN. They will not
              resolve from iPhone over the Tailscale tunnel unless separate tailscale serve
              mappings are added for those ports.
            </p>
          </CardContent>
        </Card>
      </section>

      <section aria-label="Service status">
        <h2 className="mb-2 text-sm font-semibold text-muted">Service Status</h2>
        <Card>
          <CardContent className="pt-4 text-sm italic text-muted">Service-status panel — T5.12.</CardContent>
        </Card>
      </section>
    </div>
  );
}
