// ntfy push-notification helper.
// Sends a fire-and-forget POST to the configured ntfy topic.
// Advisory only — never throws; skips silently if NTFY_URL is unset.
// NTFY_URL should be the full topic URL, e.g. https://ntfy.example.com/selfwright.

export interface NtfyOpts {
  title?: string;
  priority?: "min" | "low" | "default" | "high" | "urgent";
}

export async function notifyNtfy(message: string, opts: NtfyOpts = {}): Promise<void> {
  const url = process.env["NTFY_URL"];
  if (!url) return;

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
