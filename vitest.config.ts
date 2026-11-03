import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so unit tests never load the React Router plugin.
export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "app/**/*.test.ts"],
    environment: "node",
  },
});
