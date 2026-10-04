import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
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
        background_color: "#F3F9FC",
        theme_color: "#023E8A",
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
