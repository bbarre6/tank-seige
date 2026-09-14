import { defineConfig } from "vitest/config";

// GitHub Pages serves a project site from a /<repo>/ subpath; only apply
// that prefix in CI builds so local dev and `vite preview` stay at "/".
const base = process.env.GITHUB_ACTIONS ? "/tank-seige/" : "/";

export default defineConfig({
  base,
  server: {
    port: 5173,
  },
  test: {
    globals: true,
  },
});
