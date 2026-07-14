// FF-SCAN-1: scanner liveness classification (Task T2.3). Synthetic fixtures
// (Tier 1, no SELFWRIGHT_DATA_DIR) — a bot-challenge page must never be
// classified as expired (that would permanently filter out a job that is
// actually still live), and a genuinely dead posting must be classified as
// expired, not live/uncertain.
import { checkLiveness } from "@selfwright/core";
import type { CheckResult } from "./shared.js";

const CHECK_NAME = "FF-SCAN-1: scan liveness classification (bot-challenge never reads as expired)";

export function checkScanLiveness(): CheckResult {
  const botChallenge = checkLiveness("Just a moment... Checking your browser before accessing.");
  if (botChallenge.status === "expired") {
    return {
      name: CHECK_NAME,
      passed: false,
      details: `A bot-challenge page must never classify as "expired" (would permanently filter out a live job); got "${botChallenge.status}"`,
    };
  }

  const expired = checkLiveness("This job posting has expired. No longer accepting applications.");
  if (expired.status !== "expired") {
    return {
      name: CHECK_NAME,
      passed: false,
      details: `A clear expired-posting banner must classify as "expired"; got "${expired.status}"`,
    };
  }

  const live = checkLiveness(
    "Senior Enterprise Architect. We are looking for an experienced architect to join our growing team. Apply now.",
  );
  if (live.status !== "live") {
    return {
      name: CHECK_NAME,
      passed: false,
      details: `A posting with a visible apply control must classify as "live"; got "${live.status}"`,
    };
  }

  return { name: CHECK_NAME, passed: true };
}
