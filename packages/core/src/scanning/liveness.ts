import type { LivenessVerdict } from "./types.js";

// Ported from santifer/career-ops's liveness-core.mjs (classifyLiveness). Simplified for a
// plain-HTTP-fetch scanner (no browser rendering / no separately-extracted apply-control DOM
// list): APPLY_PATTERNS run against the fetched page text directly instead of against a
// Playwright-extracted control list.

const HARD_EXPIRED_PATTERNS = [
  /job (is )?no longer available/i,
  /job.*no longer open/i,
  /position has been filled/i,
  /this job has expired/i,
  /job posting has expired/i,
  /no longer accepting applications/i,
  /this (position|role|job) (is )?no longer/i,
  /this job (listing )?is closed/i,
  /job (listing )?not found/i,
  /the page you are looking for doesn.t exist/i,
  /applications?\s+(?:(?:have|are|is)\s+)?closed/i,
];

const LISTING_PAGE_PATTERNS = [/\d+\s+jobs?\s+found/i, /search for jobs page is loaded/i];

// Anti-bot interstitials (Cloudflare "Just a moment...", hCaptcha walls, etc.) render a tiny
// challenge page instead of the posting. They must NOT be read as expired: the body is short and
// lacks an apply control, so without this guard it falls through to "insufficient content" →
// expired, which would permanently filter out a job that is actually still live.
const BOT_CHALLENGE_PATTERNS = [
  /just a moment/i,
  /performing security verification/i,
  /checking your browser before/i,
  /verify you are (a |not a )?human/i,
  /enable javascript and cookies to continue/i,
  /attention required.*cloudflare/i,
  /\bray id\b/i,
  /\bcf-ray\b/i,
  /please complete the security check/i,
];

const EXPIRED_URL_PATTERNS = [/[?&]error=true/i];

const APPLY_PATTERNS = [
  /\bapply\b/i,
  /\bsolicitar\b/i,
  /\bbewerben\b/i,
  /\bpostuler\b/i,
  /submit application/i,
  /easy apply/i,
  /start application/i,
];

const MIN_CONTENT_CHARS = 300;

function firstMatch(patterns: RegExp[], text: string): RegExp | undefined {
  return patterns.find((pattern) => pattern.test(text));
}

export interface LivenessOpts {
  httpStatus?: number;
  finalUrl?: string;
}

export function checkLiveness(pageText: string, opts: LivenessOpts = {}): LivenessVerdict {
  const { httpStatus, finalUrl = "" } = opts;

  if (httpStatus === 404 || httpStatus === 410) {
    return { status: "expired", reason: `HTTP ${httpStatus}` };
  }

  const botChallenge = firstMatch(BOT_CHALLENGE_PATTERNS, pageText);
  if (botChallenge) {
    return { status: "uncertain", reason: `anti-bot challenge: ${botChallenge.source}` };
  }
  if (httpStatus === 403 || httpStatus === 503) {
    return { status: "uncertain", reason: `HTTP ${httpStatus} (access blocked, likely anti-bot)` };
  }

  const expiredUrl = firstMatch(EXPIRED_URL_PATTERNS, finalUrl);
  if (expiredUrl) {
    return { status: "expired", reason: `redirect to ${finalUrl}` };
  }

  const expiredBody = firstMatch(HARD_EXPIRED_PATTERNS, pageText);
  if (expiredBody) {
    return { status: "expired", reason: `pattern matched: ${expiredBody.source}` };
  }

  const applyMatch = firstMatch(APPLY_PATTERNS, pageText);
  if (applyMatch) {
    return { status: "live", reason: "visible apply control detected" };
  }

  const listingPage = firstMatch(LISTING_PAGE_PATTERNS, pageText);
  if (listingPage) {
    return { status: "expired", reason: `pattern matched: ${listingPage.source}` };
  }

  if (pageText.trim().length < MIN_CONTENT_CHARS) {
    return { status: "expired", reason: "insufficient content — likely nav/footer only" };
  }

  return { status: "uncertain", reason: "content present but no visible apply control found" };
}
