/** @jest-environment node */
const path = require("node:path")
const esbuild = require("esbuild")
const sveltePlugin = require("esbuild-svelte")
const { sveltePreprocess } = require("svelte-preprocess")
const { compile } = require("svelte/compiler")
const { JSDOM } = require("jsdom")

const project = path.resolve(__dirname, "..")
const names = new Set([
    "ActiveRetrievabilityMatrix.svelte",
    "ExposureStabilityMatrix.svelte",
    "CardAverageByMetric.svelte",
    "GraphCategory.svelte",
    "GraphContainer.svelte",
    "RevlogGraphContainer.svelte",
    "IntervalGraph.svelte",
    "i18n",
    "search",
    "stores",
])
const plugin = {
    name: "lapse-rate-mocks",
    setup(build) {
        build.onResolve({ filter: /^lapse-rate-entry$/ }, () => ({
            path: "entry",
            namespace: "test",
        }))
        build.onResolve({ filter: /^\.\.?\// }, (args) => {
            const name = args.path.split("/").at(-1)
            if (names.has(name)) return { path: name, namespace: "test" }
        })
        build.onLoad({ filter: /.*/, namespace: "test" }, (args) => {
            let contents
            if (args.path === "entry") {
                contents = `import { mount, unmount, flushSync } from "svelte";
                    import App from "${project}/src/ts/categories/LapseCategory.svelte";
                    import { revlogStats } from "./stores";
                    export const setStats = stats => revlogStats.set(stats);
                    export const start = target => mount(App, {target}); export {unmount,flushSync};`
            } else if (args.path === "GraphContainer.svelte") {
                contents = compile(
                    `<script>export let graphId;</script><section data-graph={graphId}><slot /></section>`,
                    { filename: args.path, generate: "client" }
                ).js.code
            } else if (args.path === "RevlogGraphContainer.svelte") {
                contents = compile(
                    `<script>export let graphId;</script><section data-graph={graphId}><slot name="title" /><slot name="graph" /><slot /></section>`,
                    { filename: args.path, generate: "client" }
                ).js.code
            } else if (args.path === "IntervalGraph.svelte") {
                contents = compile(
                    `<script>import {include_suspended} from "./stores"; export let intervals, steps, last, pieInfo, zero_inclusive_option;</script>
                    <output>{JSON.stringify(intervals)}</output><input type="checkbox" bind:checked={$include_suspended} />`,
                    { filename: args.path, generate: "client" }
                ).js.code
            } else if (args.path === "GraphCategory.svelte") {
                contents = compile(
                    `<script>export let hidden_title, config_name;</script><slot />`,
                    { filename: args.path, generate: "client" }
                ).js.code
            } else if (args.path === "CardAverageByMetric.svelte") {
                contents = compile(
                    `<script>export let graphId, metric, titleKey, helpKey, labelKey, colour, valueKind, allowDivideByLapses;</script>`,
                    { filename: args.path, generate: "client" }
                ).js.code
            } else if (args.path.endsWith(".svelte")) {
                contents = compile("", { filename: args.path, generate: "client" }).js.code
            } else if (args.path === "i18n") {
                contents = `export const i18n=key=>key;`
            } else if (args.path === "search") {
                contents = `export const catchErrors = fn => fn();`
            } else if (args.path === "stores") {
                contents = `import {writable} from "svelte/store";
                    export const graph_mode=writable("Bar"),zero_inclusive=writable(false),card_data=writable([]),
                    cardDataStats=writable({lapses:[],lapses_burden:[]}),include_suspended=writable(false),revlogStats=writable(null);`
            }
            return { contents, loader: "js", resolveDir: project }
        })
    },
}

test("lapse rate graph switches the suspended-card population", async () => {
    const dom = new JSDOM("<!doctype html><body></body>", {
        pretendToBeVisual: true,
        url: "https://test.invalid",
    })
    const window = dom.window
    Object.assign(global, {
        window,
        document: window.document,
        navigator: window.navigator,
        MutationObserver: window.MutationObserver,
        Element: window.Element,
        HTMLElement: window.HTMLElement,
        HTMLMediaElement: window.HTMLMediaElement,
        SVGElement: window.SVGElement,
        Node: window.Node,
        Text: window.Text,
        Comment: window.Comment,
        CustomEvent: window.CustomEvent,
        requestAnimationFrame: window.requestAnimationFrame.bind(window),
    })
    const output = await esbuild.build({
        entryPoints: ["lapse-rate-entry"],
        outfile: path.join(project, "lapse-rate-test-bundle.js"),
        bundle: true,
        write: false,
        format: "cjs",
        platform: "browser",
        conditions: ["browser"],
        plugins: [plugin, sveltePlugin({ preprocess: sveltePreprocess() })],
        logLevel: "silent",
    })
    const bundle = { exports: {} }
    new Function(
        "module",
        "exports",
        output.outputFiles.find((file) => file.path.endsWith(".js")).text
    )(bundle, bundle.exports)
    bundle.exports.setStats({ lapse_rates: { active: { 0: 1, 2: 1 }, all: { 0: 1, 2: 1, 10: 1 } } })
    const app = bundle.exports.start(document.body)
    bundle.exports.flushSync()
    const graph = document.querySelector('[data-graph="lapse:lapse-rate-by-introduction"]')
    expect(JSON.parse(graph.querySelector("output").textContent)).toEqual({ 0: 1, 2: 1 })
    graph.querySelector("input").click()
    bundle.exports.flushSync()
    expect(JSON.parse(graph.querySelector("output").textContent)).toEqual({ 0: 1, 2: 1, 10: 1 })
    bundle.exports.unmount(app)
    dom.window.close()
})
