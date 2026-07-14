import type { Config } from "tailwindcss";

// Brand tokens (T5.10): sampled from docs/brand/Brand Icon_Dark theme.png —
// deep navy background with an orange-to-blue gradient mark. The cockpit is
// dark-first (the brand asset is dark-first; the prior SSR dashboard had no
// stated theme to defer to instead).
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#0B0F24",
        surface: "#141A36",
        border: "#232B52",
        foreground: "#E7E9F5",
        muted: "#8B92B8",
        primary: {
          DEFAULT: "#4C5FE8",
          foreground: "#FFFFFF",
        },
        // Text-only emphasis (nav active state, badges, chart labels): #4C5FE8
        // as *text* on this dark background/surface measures ~3.3-3.7:1,
        // under WCAG AA's 4.5:1 for normal text (verified, not assumed — see
        // the a11y pass notes) even though it's a fine white-on-primary
        // *button fill* (5.11:1). A single blue can't satisfy both roles
        // against a background this dark, so text-only uses this lighter
        // shade instead (8.2:1 / 7.4:1 on background/surface).
        link: "#96A5FF",
        accent: {
          DEFAULT: "#E08A3C",
          foreground: "#1A1200",
        },
        destructive: {
          // Text-only use (badges, error banners): 5.65:1 / 5.08:1 on
          // background/surface — passes AA. The original #DC4C4C measured
          // 4.68:1 / 4.21:1 (the surface case failed AA); this is the
          // same "one color can't serve both text and white-on-fill roles"
          // finding as `link` above, resolved the same way.
          DEFAULT: "#E56262",
          foreground: "#FFFFFF",
          // Solid button-fill background (paired with white text via
          // `foreground` above): #DC4C4C / the lighter DEFAULT above both
          // measure under 4.5:1 white-on-fill; this measures 5.90:1.
          solid: "#B23A3A",
        },
        success: {
          DEFAULT: "#22C55E",
          foreground: "#04170A",
        },
        warning: {
          DEFAULT: "#D9A441",
          foreground: "#1A1200",
        },
        ring: "#4C5FE8",
      },
      borderRadius: {
        DEFAULT: "0.5rem",
      },
    },
  },
  plugins: [],
} satisfies Config;
