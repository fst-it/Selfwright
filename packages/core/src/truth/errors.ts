export type TruthErrorKind =
  | "FILE_NOT_FOUND"
  | "PARSE_ERROR"
  | "VALIDATION_ERROR";

export interface TruthError {
  kind: TruthErrorKind;
  message: string;
  /** Relative path within the data directory (when applicable). */
  path?: string;
}
