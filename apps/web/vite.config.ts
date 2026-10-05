import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { execSync } from "node:child_process";

/** Build info shown in Settings → About: commit, build time and repository link. */
function buildInfo() {
  const git = (cmd: string) => {
    try {
      return execSync(`git ${cmd}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      return "";
    }
  };
  const commit = process.env.GITHUB_SHA || git("rev-parse HEAD") || "";
  // CI provides the repo directly; locally derive https://github.com/<owner>/<repo> from the origin remote.
  const remote = process.env.GITHUB_REPOSITORY
    ? `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GITHUB_REPOSITORY}`
    : git("remote get-url origin").replace(/\.git$/, "").replace(/^git@github\.com:/, "https://github.com/");
  return {
    commit,
    builtAt: new Date().toISOString(),
    repoUrl: /^https:\/\//.test(remote) ? remote : "",
    ci: !!process.env.GITHUB_ACTIONS,
  };
}

export default defineConfig({
  define: { __APP_BUILD__: JSON.stringify(buildInfo()) },
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["icons/*.png", "icons/*.svg"],
      manifest: {
        id: "/",
        name: "EMI Tracker",
        short_name: "EMI Tracker",
        description: "Schedule, track and calculate loan EMIs in any currency.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait-primary",
        background_color: "#3E0709",
        theme_color: "#6E0F14",
        categories: ["finance", "productivity"],
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        shortcuts: [
          { name: "Add loan", url: "/loans/new", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
          { name: "Calendar", url: "/calendar", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
        ],
      },
      injectManifest: { globPatterns: ["**/*.{js,css,html,png,svg,woff2}"] },
      devOptions: { enabled: false, type: "module" },
    }),
  ],
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://localhost:8787", changeOrigin: false } },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
} as never);
