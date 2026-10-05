// Vitest doesn't run Vite's `define`, so provide the build-info constant for tests.
(globalThis as unknown as { __APP_BUILD__: unknown }).__APP_BUILD__ = {
  commit: "0123456789abcdef0123456789abcdef01234567",
  builtAt: "2026-10-05T10:00:00.000Z",
  repoUrl: "https://github.com/example/emi-tracker",
  ci: true,
};
