export const STOP_WORDS = new Set([
  "the", "and", "for", "that", "this", "with", "from", "have", "will",
  "your", "our", "their", "are", "was", "were", "been", "being", "into",
  "which", "when", "what", "where", "who", "how", "all", "any", "can",
  "also", "such", "both", "more", "most", "other", "some", "about", "than",
  "then", "over", "under", "after", "before", "between", "through", "during",
  "including", "across", "within", "without", "each", "every", "those", "these",
  "work", "team", "role", "need", "make", "take", "help", "use", "used",
  "ensure", "support", "manage", "provide", "deliver", "develop", "drive",
  "using", "based", "able", "well", "new", "key", "high", "level", "global",
  "senior", "manager", "associate",
]);

export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\w\s\-/&]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripMarkdown(text: string): string {
  return text
    .replace(/^#+\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`]/g, "")
    .trim();
}

export function tokenWords(s: string): string[] {
  return s.split(/\s+/).filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

export function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  const inter = [...sa].filter((x) => sb.has(x)).length;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 0 : inter / union;
}
