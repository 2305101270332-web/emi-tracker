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
          on: token("on-accent"),
          text: token("accent-text"),
          soft: token("accent-soft"),
        },
        danger: token("danger"),
        success: token("success"),
      },
      borderRadius: { card: "1rem" },
      boxShadow: { card: "0 1px 2px rgb(2 62 138 / 0.06), 0 4px 16px rgb(2 62 138 / 0.06)" },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
