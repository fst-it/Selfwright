import type { MemoryPort, MemoryEntry, MemorySearchResult } from "@selfwright/core";

const FETCH_TIMEOUT_MS = 30_000;

function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const tid = setTimeout(() => { controller.abort(); }, FETCH_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => { clearTimeout(tid); });
}

type ServiceMemoryEntry = {
  id: string;
  content: string;
  metadata?: Record<string, string>;
  createdAt: string;
};

type SearchResponse = { results: Array<{ entry: ServiceMemoryEntry; score: number }> };
type ListResponse = { results: ServiceMemoryEntry[] };

export class Mem0Adapter implements MemoryPort {
  constructor(
    private readonly baseUrl: string,
    private readonly token?: string,
  ) {}

  private authHeaders(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }

  async add(content: string, metadata?: Record<string, string>): Promise<MemoryEntry> {
    const response = await fetchWithTimeout(`${this.baseUrl}/memories`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeaders() },
      body: JSON.stringify({ content, metadata }),
    });
    if (!response.ok) {
      throw new Error(`mem0 add request failed: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as ServiceMemoryEntry;
  }

  async search(query: string, topK?: number): Promise<MemorySearchResult[]> {
    const response = await fetchWithTimeout(`${this.baseUrl}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeaders() },
      body: JSON.stringify({ query, top_k: topK }),
    });
    if (!response.ok) {
      throw new Error(`mem0 search request failed: ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as SearchResponse;
    return data.results;
  }

  async list(filter?: Record<string, string>): Promise<MemoryEntry[]> {
    const response = await fetchWithTimeout(`${this.baseUrl}/memories/list`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeaders() },
      body: JSON.stringify({ filter }),
    });
    if (!response.ok) {
      throw new Error(`mem0 list request failed: ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as ListResponse;
    return data.results;
  }
}
