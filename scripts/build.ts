import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
let html = await readFile("src/launcher/index.html", "utf8");
for (const asset of ["main.js", "main.css"]) {
    const digest = createHash("sha256")
        .update(await readFile(`dist/launcher/${asset}`))
        .digest("hex");
    html = html.replace(`./${asset}`, `./${asset}?v=${digest.slice(0, 16)}`);
}
await writeFile("dist/launcher/index.html", html);
