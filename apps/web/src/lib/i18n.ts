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

export default i18n;
