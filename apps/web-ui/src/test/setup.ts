import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Explicit, not relying on RTL's auto-detection of the test runner: unmounts
// every rendered tree after each test so DOM state never leaks between tests
// in the same file (e.g. two tests both rendering a table with a "Save"
// button or an "applied" status badge).
afterEach(() => {
  cleanup();
});

