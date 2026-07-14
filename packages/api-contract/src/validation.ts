// Shared validation primitives for the /api/* JSON contract (T5.9).
//
// hasControlChars is a standalone char-code scan (not a regex literal with hex
// escapes) — ADR 0019 found that hex-escape regex literals proved fragile to
// reproduce byte-for-byte through this session's tooling (an early draft of a
// control-char regex was silently corrupted into literal control bytes by the
// file-write path). This primitive originated in the SSR write path (the
// since-deleted apps/web/src/routes/actions.ts); it was copied here deliberately
// (6 lines) rather than introducing a cross-package dependency edge onto the
// contract package. After T5.10's clean cutover deleted the SSR forms, this is
// now the sole home of the primitive for the /api/* write handlers.

/**
 * True if the string contains any ASCII control character (code points below
 * 0x20, or DEL at 0x7F).
 */
export function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}
