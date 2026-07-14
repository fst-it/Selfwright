# Selfwright — Metrics & North-Star

## North-star metric

**Interview-conversion rate per 10 applications** — the ratio of first-round interviews secured per 10 applications submitted. This is the ultimate proxy for platform quality (CV + cover + ATS + targeting all compound here).

Target: track and improve this baseline; no specific threshold until Phase 1 DoD.

## North-star measurement

**Formula:** `ratePerTen = (interviews / submitted) * 10`, rounded to 2 decimal places. Only
applications whose `status` is one of `applied | interview | offer | rejected | withdrawn` count as
`submitted`; `to_apply`, `promoted`, and any other value are excluded. Applications whose status is
`interview` or `offer` count as `interviews` (an offer necessarily means a first interview occurred).

**Undercount caveat:** status history is not tracked. An application that reached interview stage
and was later rejected is recorded as `status: rejected`, so it counts as submitted but *not* as
interviewed — causing the interview count to be understated for that application. The metric is a
lower bound on the true conversion rate, not an exact figure.

**Data source:** `<SELFWRIGHT_DATA_DIR>/applications/applications.yml`. Computed by
`computeNorthStar` in `packages/core/src/services/north-star.ts`.

## Guardrail metrics — redefined 2026-07-01 (ADR 0006, gateway pivot)

Cost telemetry moves from **per-call USD** to **per-application token/time**. Under the
subscription-only constraint (Claude Pro / ChatGPT Plus — no API keys, no metered gateway by
default; anchor D11 superseded), most applications now involve **zero** metered LLM API calls:
the default co-pilot path is the Claude Code session the owner is already in producing text, not
an API call `tools/src/metrics.ts` can observe. What's measurable and load-bearing is *time*
end-to-end, and — only when the optional `--adapter` headless escape hatch is used — *token
counts* (still no per-call USD; see Notes).

| Metric | What | Target |
|--------|------|--------|
| Time from discovery to submit | Calendar days from role found → application sent | ≤ 3 days |
| Time per ready-application (co-pilot path) | Wall-clock from `cover-prompt.md`/`research-prompt.md` written → `--check` passes | Track; baseline set after Phase 1 LLM-tier close-out (Phase 2, T2.2) |
| Token count per headless call (`--adapter` only) | `inputTokens`/`outputTokens` from `UsageRecord` (`tools/src/metrics.ts`) | Track; no `costUsd` under a subscription — see Notes |
| Discovery-to-queue rate | Roles scanned → fit-scored → queued | Track; no target until scanner live (Phase 2, T2.3) |

## Measurement infrastructure

- **Per-call (`--adapter` headless path only):** `tools/src/metrics.ts`'s `UsageRecord` →
  `appendUsageRecord` → `<dataDir>/telemetry/usage.jsonl` (in the private data repo). `costUsd` is optional and is expected
  to be **absent** for `ClaudeCliAdapter` calls (subscription, no per-token price) and for local
  models; only `LiteLlmAdapter` against a metered provider would populate it, and that path is
  now optional/OSS-only, never the default. As of T3.0, `ClaudeCliAdapter` and `OllamaAdapter`
  also call `appendUsageRecord`, so `inputTokens`/`outputTokens`/`wallTimeMs` are now captured
  for all three adapters — `costUsd` absent or zero for these paths remains expected and correct.
- **Default co-pilot path:** no `UsageRecord` is generated — there is no LLM call to observe. Time
  is the only measurable dimension here; instrument at the application level (prompt-file-written
  → `--check`-passed timestamps), not per-call.
- **Aggregate:** Phase 3 — Metabase + Evidence.dev dashboards over the Postgres projection.

## How to view usage data

```bash
# tail latest usage (--adapter headless calls only — the default co-pilot path writes none)
tail -20 "$SELFWRIGHT_DATA_DIR/telemetry/usage.jsonl" | jq .

# token counts by role (no reliable per-call cost under a subscription — see Notes)
cat "$SELFWRIGHT_DATA_DIR/telemetry/usage.jsonl" | jq -s 'group_by(.role) | .[] | {role: .[0].role, total_out: [.[].outputTokens] | add}'

# total cost, where present (only meaningful for --adapter litellm against a metered provider)
cat "$SELFWRIGHT_DATA_DIR/telemetry/usage.jsonl" | jq -s '[.[].costUsd | values] | add'
```

## Notes

- Telemetry (`usage.jsonl`, `fitness-history.jsonl`) lives in `<dataDir>/telemetry/` in the
  private Selfwright-data repo — versioned and durable across machine migrations. Push the data
  repo regularly to keep it backed up.
- **Cost telemetry redefined 2026-07-01** (ADR 0006): the original "Token cost per ready-application ≤ $0.50/app" and "Cost per LLM call" guardrails assumed the LiteLLM/API-key gateway (anchor D11, superseded). Under the subscription-only constraint, that per-call USD baseline no longer applies to the default path — see the Guardrail metrics table above.
- Phase 2's LLM-tier DoD close-out (T2.2) establishes the time-per-application baseline after the first co-piloted cover/research on a real role.
- If an `--adapter` call does not return cost (Claude Pro subscription via `ClaudeCliAdapter`, or local Ollama), `costUsd` will be absent from the record — this is now the common case, not the exception.
