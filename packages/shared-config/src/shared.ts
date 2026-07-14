export function toMessage(e: unknown): string {
  /* v8 ignore next -- fs/yaml/zod always throw Error subclasses in practice */
  return e instanceof Error ? e.message : String(e);
}
