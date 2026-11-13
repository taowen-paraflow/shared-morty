import { context } from "esbuild";

const builder = await context({
    entryPoints: ["src/launcher/main.ts"],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2023",
    outdir: "dist/launcher",
});
const { mkdir, cp } = await import("node:fs/promises");
await mkdir("dist/launcher", { recursive: true });
await cp("src/launcher/index.html", "dist/launcher/index.html");
await builder.watch();
const server = await builder.serve({ servedir: "dist/launcher", host: "127.0.0.1", port: 4173 });
console.log(`Shared Morty: http://127.0.0.1:${server.port}`);
const close = async () => {
    await builder.dispose();
};
process.once("SIGINT", close);
process.once("SIGTERM", close);
