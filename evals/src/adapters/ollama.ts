import type { LlmPort } from "@selfwright/core";
import { OllamaAdapter } from "@selfwright/adapter-llm-ollama";

export function createOllamaCandidate(model = "llama3.2:3b"): LlmPort {
  const baseUrl = process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434";
  return new OllamaAdapter(model, baseUrl);
}
