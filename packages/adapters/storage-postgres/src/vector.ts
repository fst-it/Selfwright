export function toVectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(",")}]`;
}
