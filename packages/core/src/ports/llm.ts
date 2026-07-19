import type { ZodSchema } from "zod";

export type Message = {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
};

export type LlmUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd?: number;
};

export type LlmResult = {
  readonly content: string;
  readonly usage: LlmUsage;
};

export type LlmRequest = {
  readonly role: string;
  readonly messages: readonly Message[];
  readonly schema?: ZodSchema;
};

export interface LlmPort {
  complete(req: LlmRequest): Promise<LlmResult>;
}
