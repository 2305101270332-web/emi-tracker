import type { Config } from "tailwindcss";

/** Colours map to CSS custom properties (design tokens) defined in src/index.css. */
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: token("bg"),
        surface: token("surface"),
        "surface-2": token("surface-2"),
        fg: token("text"),
        muted: token("muted"),
        line: token("border"),
        primary: {
          DEFAULT: token("primary"),
          strong: token("primary-strong"),
          soft: token("primary-soft"),
          on: token("on-primary"),
        },
        accent: {
          DEFAULT: token("accent"),
          bright: token("accent-bright"),
          on: token("on-accent"),
          text: token("accent-text"),
          soft: token("accent-soft"),
        },
        danger: { DEFAULT: token("danger"), on: token("on-danger") },
        success: token("success"),
        frame: { text: token("frame-text"), muted: token("frame-muted") },
      },
      borderRadius: { card: "1rem" },
      boxShadow: {
        card: "0 1px 2px rgb(var(--frame-to) / 0.08), 0 8px 24px -12px rgb(var(--frame-to) / 0.25)",
        glow: "0 0 0 3px rgb(var(--accent) / 0.28), 0 0 14px rgb(var(--accent) / 0.25)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        display: ["Cinzel", "Georgia", "Times New Roman", "serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
