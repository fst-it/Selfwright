import { useApiQuery } from "./use-api-query.js";
import { SettingsContractSchema } from "@selfwright/api-contract";

/**
 * Returns the table row density from settings.yml.
 * Falls back to "comfortable" during loading, on error, or when the setting
 * is absent — so this hook never blocks render and never throws.
 */
export function useTableDensity(): "compact" | "comfortable" {
  const q = useApiQuery("/api/settings", SettingsContractSchema);
  if (q.status !== "ready") return "comfortable";
  return q.data.dashboard?.table_density ?? "comfortable";
}
