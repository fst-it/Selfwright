// ntfy push-notification helper.
// Sends a fire-and-forget POST to the configured ntfy topic.
// Advisory only — never throws; skips silently if NTFY_URL is unset.
// NTFY_URL should be the full topic URL, e.g. https://ntfy.example.com/selfwright.

export interface NotifyOpts {
  title?: string;
  priority?: "min" | "low" | "default" | "high" | "urgent";
  /**
   * Logical kind of this notification (e.g. "inbox", "scan"). When set,
   * the notification is suppressed if config.enabledDigests is present and
   * does not include this kind.
   */
  digestKind?: string;
}

/**
 * Runtime config for notify() — loaded from settings.yml by the CLI and
 * passed through to every notify() call so the owner's preferences are
 * honoured without needing to re-read the file on every notification.
 */
export interface NotifyConfig {
  /** Override the NTFY_URL env var with this URL (settings.notifications.ntfy_topic). */
  urlOverride?: string;
  /**
   * Quiet-hours window (24-hour clock). When the local hour is within
   * [start, end) the notification is suppressed.
   */
  quietHours?: { start: number; end: number };
  /**
   * Allow-list of digest kinds to push. When absent, all notify() calls
   * proceed. When present, calls whose opts.digestKind is not in this list
   * are suppressed (settings.notifications.enabled_digests).
   */
  enabledDigests?: string[];
}

function isQuietHour(quietHours: { start: number; end: number }): boolean {
  const hour = new Date().getHours();
  const { start, end } = quietHours;
  if (start <= end) {
    // e.g. 22–24 or 0–6 (same-day window)
    return hour >= start && hour < end;
  }
  // Wrap-around window, e.g. start=22, end=7 → 22..23 and 0..6
  return hour >= start || hour < end;
}

export async function notify(
  message: string,
  opts: NotifyOpts = {},
  config?: NotifyConfig,
): Promise<void> {
  const url = config?.urlOverride ?? process.env["NTFY_URL"];
  if (!url) return;

  if (config?.quietHours !== undefined && isQuietHour(config.quietHours)) return;

  if (
    opts.digestKind !== undefined &&
    config?.enabledDigests !== undefined &&
    !config.enabledDigests.includes(opts.digestKind)
  ) return;

  const headers: Record<string, string> = {
    "Content-Type": "text/plain; charset=utf-8",
  };
  if (opts.title !== undefined) headers["Title"] = opts.title;
  if (opts.priority !== undefined) headers["Priority"] = opts.priority;

  try {
    await fetch(url, {
      method: "POST",
      headers,
      body: message,
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Advisory — never surface ntfy failures to the caller.
  }
}

// Coaching notifications must carry only gap/evidence IDs — never free-text claims,
// answers, or other content that could leak PII or assessment data through this path.
export function notifyCoaching(
  ids: string[],
  title: string,
  config?: NotifyConfig,
): Promise<void> {
  return notify(ids.join(", "), { title }, config);
}
