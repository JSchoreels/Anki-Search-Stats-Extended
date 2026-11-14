import { typecheckPlugin } from "@jgoz/esbuild-plugin-typecheck"
import esbuild from "esbuild"
import esbuildSvelte from "esbuild-svelte"
import { sveltePreprocess } from "svelte-preprocess"

await esbuild.build({
    entryPoints: ["src/ts/index.ts"],
    outfile: "stats.min.js",
    bundle: true,
    minify: false,
    target: "chrome77", // For Qt5
    plugins: [
        esbuildSvelte({
            preprocess: sveltePreprocess(),
        }),
        typecheckPlugin({
            configFile: "src/ts/tsconfig.json",
        }),
    ],
})
await esbuild.build({
    entryPoints: ["src/ts/stats-worker.ts"],
    outfile: "stats-worker.js",
    bundle: true,
    format: "iife",
    target: "chrome77",
})
