import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["tests/**/*.integration.test.ts"],
        environment: "node",
        setupFiles: ["tests/support/browser-storage.ts"],
        testTimeout: 10_000,
    },
});
