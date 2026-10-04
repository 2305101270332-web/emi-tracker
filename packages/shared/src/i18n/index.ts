import { en, type Translation } from "./en";

export const resources: Record<string, Translation> = { en };
export const SUPPORTED_LANGUAGES = Object.keys(resources);
export type { Translation };
export { en };

/**
 * Minimal i18next-compatible translator for server-side use (emails, push
 * payloads) where pulling in i18next is unnecessary. Supports {{var}}
 * interpolation and `_one` plural suffix via `count`.
 */
export function createTranslator(language = "en") {
  const dict = (resources[language.split("-")[0]!] ?? en) as unknown as Record<string, unknown>;
  return function t(key: string, vars: Record<string, string | number> = {}): string {
    const parts = key.split(".");
    const lookup = (k: string[]) => k.reduce<unknown>((o, p) => (o as Record<string, unknown> | undefined)?.[p], dict);
    let value: unknown;
    if (vars.count === 1) value = lookup([...parts.slice(0, -1), parts.at(-1)! + "_one"]);
    value ??= lookup(parts);
    if (typeof value !== "string") return key;
    return value.replace(/\{\{(\w+)\}\}/g, (_, v: string) => String(vars[v] ?? ""));
  };
}
