import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { resources } from "@emi/shared";

/**
 * All UI strings live in packages/shared/src/i18n (shared with server emails).
 * To add a language: add <lang>.ts there, register it in resources, done.
 */
void i18n.use(initReactI18next).init({
  resources: Object.fromEntries(Object.entries(resources).map(([lng, tr]) => [lng, { translation: tr }])),
  lng: (typeof navigator !== "undefined" && navigator.language?.split("-")[0]) || "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});

// Keep <html lang> in sync for screen readers and hyphenation.
if (typeof document !== "undefined") {
  // resolvedLanguage = the language actually shown (falls back to "en" if the browser's isn't available).
  const setLang = () => (document.documentElement.lang = i18n.resolvedLanguage ?? "en");
  setLang();
  i18n.on("languageChanged", setLang);
}

export default i18n;
