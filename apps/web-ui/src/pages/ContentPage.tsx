import { ContentResponseSchema } from "@selfwright/api-contract";
import { useApiQuery } from "../lib/use-api-query.js";
import { Card } from "../components/ui/card.js";
import { Loading, ErrorBanner, Empty } from "../components/Status.js";

export default function ContentPage() {
  const query = useApiQuery("/api/content", ContentResponseSchema);

  if (query.status === "loading") return <Loading label="content" />;
  if (query.status === "error") return <ErrorBanner message={query.message} />;

  const { digests, latestDigest } = query.data;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Content</h1>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted">Digests ({digests.length})</h2>
        {digests.length === 0 ? (
          <Empty>No content digests found.</Empty>
        ) : (
          <ul className="list-inside list-disc text-sm">
            {digests.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
      </section>

      {latestDigest !== null ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted">Latest digest: {latestDigest.file}</h2>
          <Card>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words p-4 text-xs text-foreground">
              {latestDigest.content}
            </pre>
          </Card>
        </section>
      ) : null}
    </div>
  );
}
