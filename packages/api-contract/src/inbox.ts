import { z } from "zod";

// Mirrors packages/core/src/services/types.ts InboxItem/InboxReport. Read-only
// (T5.10): the cockpit's Overview page previously had no equivalent of the SSR
// /inbox page's item-level three-tier digest (routes/inbox.tsx) — GET
// /api/overview only ever exposed tier counts, matching what the old SSR
// Overview page itself showed. This closes that parity gap.
export const InboxItemSchema = z.object({
  kind: z.enum(["application", "queue", "drift", "coaching", "content"]),
  id: z.string(),
  title: z.string(),
  detail: z.string(),
});
export type InboxItemContract = z.infer<typeof InboxItemSchema>;

export const InboxResponseSchema = z.object({
  asOf: z.string(),
  decideNow: z.array(InboxItemSchema),
  reviewSoon: z.array(InboxItemSchema),
  fyi: z.array(InboxItemSchema),
});
export type InboxResponse = z.infer<typeof InboxResponseSchema>;
