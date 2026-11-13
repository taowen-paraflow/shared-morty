import { cp, mkdir } from "node:fs/promises";
import { build } from "esbuild";

await mkdir("dist/launcher", { recursive: true });
await build({
    entryPoints: ["src/launcher/main.ts"],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2023",
    minify: true,
    outfile: "dist/launcher/main.js",
});
await cp("src/launcher/index.html", "dist/launcher/index.html");
