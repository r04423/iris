import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  base: "/iris/space-shooter/",
  server: {
    port: 3000,
  },
  build: {
    outDir: "dist",
  },
});
