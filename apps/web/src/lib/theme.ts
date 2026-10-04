import { useEffect } from "react";
import type { Settings } from "@emi/shared";

export function applyTheme(theme: Settings["theme"]) {
  try {
    localStorage.setItem("emi-theme", theme);
  } catch {
    /* storage unavailable */
  }
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function useTheme(theme: Settings["theme"] | undefined) {
  useEffect(() => {
    if (!theme) return;
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => applyTheme("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [theme]);
}
