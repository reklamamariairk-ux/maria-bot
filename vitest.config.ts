// Конфиг vitest — минимальный: тесты живут в tests/ (вне tsconfig include,
// чтобы не попадать в сборку `npm run build` → dist/). TS компилирует сам vitest.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
