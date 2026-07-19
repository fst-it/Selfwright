// Bundled, deterministic common-word set for the named-entity scanner (ADR 0017 §1).
// Purpose: a single *unusual* token (e.g. an uncommon employer name) is confidential and must match
// alone; a single *common* token (e.g. "booking", "park", or a common first name like
// "Jane") must NOT match alone even if it happens to be part of a derived confidential
// entity, because standalone it is far too common a word/name to be a reliable signal —
// the multi-word phrase match (e.g. "Jane Doe", "Blorptech.io") still catches the real leak.
//
// Hand-curated, no network dependency (bus factor — anchor §4.8): top-frequency English
// words plus the most common English given names. Extend by adding entries; never remove
// an entry to "make a specific name match" — that defeats the point (use the per-(term,
// path) allowlist in .confidential-allowlist.yml for narrow, contextual exceptions instead).
//
// All entries are lowercase; matching against this set is case-insensitive (the caller
// lowercases before checking membership).

const COMMON_ENGLISH_WORDS: readonly string[] = [
  // Function words / high-frequency general vocabulary
  "about", "above", "after", "again", "against", "all", "also", "always", "among",
  "and", "another", "any", "anyone", "anything", "around", "back", "because", "been",
  "before", "being", "below", "between", "both", "but", "came", "can", "cannot",
  "come", "could", "day", "days", "did", "does", "done", "down", "during", "each",
  "either", "else", "even", "every", "few", "find", "first", "for", "found", "from",
  "further", "get", "give", "given", "goes", "going", "good", "great", "had", "has",
  "have", "having", "here", "how", "however", "into", "its", "itself", "just",
  "keep", "kind", "know", "known", "large", "last", "later", "least", "less",
  "like", "long", "look", "made", "make", "many", "may", "maybe", "might", "more",
  "most", "much", "must", "need", "never", "new", "next", "not", "now", "off",
  "often", "once", "only", "onto", "other", "others", "our", "out", "over", "own",
  "part", "please", "same", "say", "see", "seen", "several", "shall", "should",
  "since", "small", "some", "someone", "something", "soon", "still", "such", "sure",
  "take", "than", "that", "the", "their", "them", "then", "there", "these", "they",
  "this", "those", "through", "thus", "time", "times", "today", "too", "took",
  "toward", "under", "until", "upon", "used", "using", "very", "want", "was", "way",
  "well", "went", "were", "what", "when", "where", "whether", "which", "while",
  "who", "whole", "whom", "whose", "why", "will", "with", "within", "without",
  "would", "year", "years", "yet", "you", "your", "yours",
  // Common business / tech vocabulary likely to collide with company-style names
  "able", "access", "account", "action", "active", "add", "advice", "agency",
  "agent", "app", "apply", "area", "asset", "assets", "average", "base", "basic",
  "board", "book", "booking", "bridge", "build", "building", "business", "call",
  "capital", "care", "career", "case", "central", "change", "channel", "chart",
  "check", "choice", "city", "class", "clear", "client", "cloud", "code", "common",
  "company", "compare", "complete", "connect", "content", "control", "core", "cost",
  "count", "create", "credit", "current", "custom", "customer", "data", "deal",
  "delta", "design", "detail", "digital", "direct", "dream", "drive", "east",
  "energy", "engine", "engineer", "enterprise", "event", "expert", "express",
  "field", "finance", "financial", "fit", "flow", "focus", "force", "form",
  "forward", "free", "front", "fund", "future", "gate", "general", "global",
  "goal", "grand", "green", "grid", "group", "growth", "guide", "health", "help",
  "high", "hill", "hire", "home", "horizon", "house", "hub", "human", "idea",
  "impact", "index", "info", "insight", "install", "instant", "job", "join",
  "key", "labs", "lake", "land", "lane", "launch", "lead", "leader", "learn",
  "level", "life", "light", "line", "link", "list", "live", "local", "logic",
  "main", "manage", "map", "market", "master", "matrix", "media", "meet",
  "member", "memory", "menu", "merge", "meta", "metric", "mile", "mind", "mode",
  "model", "modern", "mount", "move", "national", "native", "net", "network",
  "next", "node", "north", "note", "office", "onboard", "online", "open", "order",
  "over", "page", "park", "partner", "path", "pay", "peak", "people", "pilot",
  "pioneer", "place", "plan", "platform", "point", "portal", "power", "premier",
  "prime", "print", "product", "profile", "program", "project", "prompt", "quality",
  "quest", "quick", "rank", "rapid", "rate", "reach", "ready", "real", "region",
  "remote", "report", "reserve", "review", "reward", "ridge", "right", "rise",
  "risk", "river", "road", "root", "route", "safe", "sales", "scale", "scan",
  "scope", "score", "search", "sector", "secure", "select", "sense", "serve",
  "service", "session", "setup", "share", "shift", "shop", "sight", "signal",
  "site", "smart", "social", "solution", "source", "south", "space", "spark",
  "speed", "spirit", "sprint", "stack", "staff", "stage", "star", "start", "state",
  "status", "stay", "step", "stone", "store", "story", "strategy", "stream",
  "street", "strong", "study", "style", "success", "summit", "support", "survey",
  "switch", "system", "table", "talent", "target", "task", "team", "tech",
  "template", "test", "text", "think", "title", "tool", "top", "total", "touch",
  "tower", "track", "trade", "trading", "train", "trans", "travel", "trend",
  "trust", "type", "union", "unique", "unit", "update", "user", "valley",
  "value", "vault", "vector", "vendor", "venture", "verify", "version", "view",
  "vision", "visit", "vital", "wave", "web", "west", "wide", "work", "world",
  "zone", "true", "hard", "soft", "safe",
];

// Common English given names — deliberately generic so a single confidential first
// name never triggers a standalone match; the full "First Last" phrase still does.
const COMMON_GIVEN_NAMES: readonly string[] = [
  "james", "john", "robert", "michael", "william", "david", "richard", "joseph",
  "thomas", "charles", "christopher", "daniel", "matthew", "anthony", "mark",
  "donald", "steven", "andrew", "paul", "joshua", "kenneth", "kevin", "brian",
  "george", "timothy", "ronald", "edward", "jason", "jeffrey", "ryan", "jacob",
  "gary", "nicholas", "eric", "jonathan", "stephen", "larry", "justin", "scott",
  "brandon", "benjamin", "samuel", "gregory", "alexander", "patrick", "frank",
  "raymond", "jack", "dennis", "jerry", "tyler", "aaron", "jose", "adam", "nathan",
  "henry", "douglas", "zachary", "peter", "kyle", "walter", "ethan", "jeremy",
  "harold", "keith", "christian", "roger", "noah", "gerald", "carl", "terry",
  "sean", "austin", "arthur", "lawrence", "jesse", "dylan", "bryan", "joe",
  "jordan", "billy", "bruce", "albert", "willie", "gabriel", "logan", "alan",
  "juan", "wayne", "roy", "ralph", "randy", "eugene", "vincent", "russell",
  "elijah", "louis", "bobby", "philip", "johnny", "chris", "sam", "alex", "mike",
  "mary", "patricia", "jennifer", "linda", "elizabeth", "barbara", "susan",
  "jessica", "karen", "nancy", "lisa", "margaret", "betty", "sandra", "ashley",
  "kimberly", "donna", "emily", "michelle", "carol", "amanda", "melissa",
  "deborah", "stephanie", "rebecca", "laura", "sharon", "cynthia", "kathleen",
  "amy", "shirley", "angela", "helen", "anna", "brenda", "pamela", "nicole",
  "ruth", "katherine", "samantha", "christine", "catherine", "virginia", "debra",
  "rachel", "carolyn", "janet", "maria", "heather", "diane", "julie", "joyce",
  "victoria", "kelly", "christina", "joan", "evelyn", "judith", "andrea",
  "hannah", "megan", "cheryl", "jacqueline", "martha", "madison", "teresa",
  "gloria", "sara", "janice", "ann", "kathryn", "abigail", "sophia", "frances",
  "jean", "alice", "judy", "isabella", "julia", "grace", "amber", "denise",
  "danielle", "marilyn", "beverly", "charlotte", "natalie", "theresa", "diana",
  "brittany", "doris", "kayla", "alexis", "lori", "jane", "emma", "olivia",
];

export const COMMON_WORDS: ReadonlySet<string> = new Set([
  ...COMMON_ENGLISH_WORDS,
  ...COMMON_GIVEN_NAMES,
]);
