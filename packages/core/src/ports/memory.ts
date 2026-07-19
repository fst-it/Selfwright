export type MemoryEntry = {
  readonly id: string;
  readonly content: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly createdAt: string;
};

export type MemorySearchResult = {
  readonly entry: MemoryEntry;
  readonly score: number;
};

export interface MemoryPort {
  add(content: string, metadata?: Record<string, string>): Promise<MemoryEntry>;
  search(query: string, topK?: number): Promise<MemorySearchResult[]>;
  list(filter?: Record<string, string>): Promise<MemoryEntry[]>;
}
