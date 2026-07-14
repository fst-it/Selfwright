# Selfwright and career-ops

[career-ops](https://github.com/santifer/career-ops) (MIT) is a local-first, no-telemetry,
human-in-the-loop job-search platform that turns an AI coding CLI into an application-management
system. If you have seen it, Selfwright will look familiar in its foundations and different in its
center of gravity. This page is an honest orientation for anyone choosing between the two, or
curious how they differ. It reflects career-ops as of its public README in mid-2026; check the
source for its current state.

## Where they agree

Both keep your data on your own machine. Neither emits telemetry. Both keep a human in the loop and
refuse to auto-submit an application on a career site. Both tailor ATS-parseable CVs to a specific
job description, scan public ATS boards for roles, and score fit against archetypes instead of
optimizing for application volume. Selfwright's provider set was widened partly after studying
career-ops's board coverage, so the overlap there is deliberate.

## Where Selfwright places its weight

- **A truth floor as the core constraint.** Every generated artifact — cover letter, research
  document, prep pack, interview drill — has to trace back to a locked evidence registry (`EVD-*`
  ids) before it counts as done. A truth-trace validator, honesty-wall phrase checks, and scored
  "drifts" (the single audited exception) enforce that. career-ops grounds output in your CV and
  reasons about fit; Selfwright makes grounding a gate you cannot skip, and logs every deviation.
- **Architecture enforced by fitness functions.** 33 checks (28 of them in CI) hold the
  hexagonal/DDD boundaries, block provider imports from reaching the domain core, and fail closed.
  A named-entity data-leak gate, derived from your private data at commit time, stops personal
  information from ever landing in the public framework repo — pre-commit and in CI.
- **Claude Code native, no API keys.** The default path assembles a truth-grounded prompt and hands
  it to the Claude session you already have open, then validates what comes back. There is no
  gateway to run and no key to configure. career-ops takes the opposite, provider-agnostic bet.
- **Scope past the application.** Selfwright treats the job search as one of four compounding goals
  — career engine, coach, content, expertise — with a coaching loop (debrief → gap-scan → drill)
  and a React web cockpit over a typed API.

## Where career-ops will suit some people better

- **Provider and model choice.** It runs across many AI CLIs and API providers out of the box,
  including a documented free Gemini tier, where Selfwright is Claude-Code-first.
- **More lifecycle automation shipped today.** Recruiter and referral outreach drafts, application
  form auto-fill, and negotiation scripts, plus a Go terminal dashboard and a larger set of
  preconfigured companies and boards.
- **MIT license and a public track record.** Selfwright is Apache-2.0; career-ops's author has
  documented landing a role with it.

## Which one to reach for

Want provider flexibility, a broad set of application-lifecycle helpers, and a terminal-first
workflow? career-ops is an excellent fit. Want verifiability enforced in code, a Claude-Code-native
path with no API keys, and a system that compounds interview and coaching data into a private
knowledge base over time? That is the bet Selfwright makes. Two honest takes on the same problem,
both keeping your data where it belongs.
