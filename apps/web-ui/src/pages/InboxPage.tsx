import { InboxResponseSchema, type InboxItemContract } from "@selfwright/api-contract";
import { useApiQuery } from "../lib/use-api-query.js";
import { Card } from "../components/ui/card.js";
import { Badge } from "../components/ui/badge.js";
import { Loading, ErrorBanner, Empty } from "../components/Status.js";

function Tier({
  label,
  variant,
  items,
}: {
  label: string;
  variant: "destructive" | "warning" | "default";
  items: InboxItemContract[];
}) {
  return (
    <section aria-label={label} className="mb-4">
      <div className="mb-2 flex items-center gap-2">
        <Badge variant={variant}>{label}</Badge>
        <span className="text-xs text-muted">({items.length})</span>
      </div>
      {items.length === 0 ? (
        <Empty>Nothing here.</Empty>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li key={item.id} className="p-3">
                <div className="text-sm font-medium">{item.title}</div>
                <div className="mt-0.5 text-xs text-muted">{item.detail}</div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

export default function InboxPage() {
  const query = useApiQuery("/api/inbox", InboxResponseSchema);

  if (query.status === "loading") return <Loading label="inbox" />;
  if (query.status === "error") return <ErrorBanner message={query.message} />;

  const { asOf, decideNow, reviewSoon, fyi } = query.data;

  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-xl font-semibold">Inbox</h1>
      <p className="mb-3 text-xs italic text-muted">As of {asOf.slice(0, 10)}</p>
      <Tier label="Decide-now" variant="destructive" items={decideNow} />
      <Tier label="Review-soon" variant="warning" items={reviewSoon} />
      <Tier label="FYI" variant="default" items={fyi} />
    </div>
  );
}
