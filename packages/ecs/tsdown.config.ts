import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "neutral",
  // Preserve the existing ESNext output; applications choose their browser target.
  target: false,
  tsconfig: "tsconfig.build.json",
  clean: false,
  minify: false,
  sourcemap: true,
  // Runtime maps embed sources. Avoid declaration maps pointing to unpublished src.
  dts: { sourcemap: false },
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
  publint: true,
  attw: { profile: "esm-only", level: "error" },
});
