export type CheckResult = {
  readonly name: string;
  readonly passed: boolean;
  // skipped = true means the check could not run (e.g. no SELFWRIGHT_DATA_DIR).
  // A skipped check is NOT a passing check — CI reporters show it as "~" not "✓".
  readonly skipped?: boolean;
  readonly details?: string;
};

export type Check = () => Promise<CheckResult> | CheckResult;
