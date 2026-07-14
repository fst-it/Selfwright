import type { ReactNode } from "react";

export function Loading({ label }: { label: string }) {
  return (
    <p role="status" className="text-sm text-muted">
      Loading {label}…
    </p>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm italic text-muted">{children}</p>;
}
