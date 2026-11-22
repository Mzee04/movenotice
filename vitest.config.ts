import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    projects: [
      { extends: true, test: { name: "cli", include: ["cli/**/*.test.ts"], environment: "node" } },
      { extends: true, test: { name: "web", include: ["web/src/**/*.test.{ts,tsx}"], environment: "jsdom" } },
    ],
  },
});
