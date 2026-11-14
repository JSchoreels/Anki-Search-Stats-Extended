/** @jest-environment node */
const path = require("node:path")
const esbuild = require("esbuild")
const sveltePlugin = require("esbuild-svelte")
const { sveltePreprocess } = require("svelte-preprocess")
const { compile } = require("svelte/compiler")
const { JSDOM } = require("jsdom")

const project = path.resolve(__dirname, "..")
const plugin = {
    name: "average-card-mocks",
    setup(build) {
        build.onResolve({ filter: /^average-card-entry$/ }, () => ({
            path: "entry",
            namespace: "test",
        }))
        build.onResolve({ filter: /^\.\// }, (args) => {
            if (
                [
                    "./BarScrollable.svelte",
                    "./GraphContainer.svelte",
                    "./NoGraph.svelte",
                    "./bar",
                    "./i18n",
                    "./search",
                    "./stores",
                ].includes(args.path)
            )
                return { path: args.path, namespace: "test" }
        })
        build.onLoad({ filter: /.*/, namespace: "test" }, (args) => {
            let contents
            if (args.path === "entry") {
                contents = `import { mount, unmount, flushSync } from "svelte";
                    import App from "${project}/src/ts/CardAverageByMetric.svelte";
                    import { card_data, include_suspended } from "./stores";
                    import { get } from "svelte/store";
                    export const setCards = cards => card_data.set(cards);
                    export const setInclude = value => include_suspended.set(value);
                    export const includeValue = () => get(include_suspended);
                    export const start = (target, extra={}) => mount(App, {target, props:{graphId:"lapse:average-load", metric:"lapses", titleKey:"title", helpKey:"help", labelKey:"lapses", colour:"red", ...extra}});
                    export { unmount, flushSync };`
            } else if (args.path === "./BarScrollable.svelte") {
                contents = compile(
                    `<script>export let data, binSize=1, offset=0, left_aligned, aggregateValues, search; $: value = data && aggregateValues(1, 2)[0];</script>
                    <output data-average>{value}</output><button data-search on:click={() => search(1, 2)}>Search</button>`,
                    { filename: "BarScrollable.svelte", generate: "client" }
                ).js.code
            } else if (args.path === "./GraphContainer.svelte") {
                contents = compile(
                    `<script>export let graphId;</script><section data-graph={graphId}><slot /></section>`,
                    { filename: "GraphContainer.svelte", generate: "client" }
                ).js.code
            } else if (args.path === "./NoGraph.svelte") {
                contents = compile("<p>No data</p>", {
                    filename: "NoGraph.svelte",
                    generate: "client",
                }).js.code
            } else if (args.path === "./bar") {
                contents = `export const rangeBarStringLabeler = () => () => "range";`
            } else if (args.path === "./i18n") {
                contents = `export const i18n = key => key; export const i18n_bundle = {getMessage: () => ({value:"range"})};`
            } else if (args.path === "./search") {
                contents = `export const browserSearchCurrent = query => {globalThis.averageSearch = query};`
            } else if (args.path === "./stores") {
                contents = `import { writable } from "svelte/store"; export const card_data=writable(null), include_suspended=writable(false);`
            }
            return { contents, loader: "js", resolveDir: project }
        })
    },
}

test("average graph updates for suspended cards and searches the selected range", async () => {
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
        entryPoints: ["average-card-entry"],
        outfile: path.join(project, "average-test-bundle.js"),
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
    bundle.exports.setCards([
        { reps: 3, lapses: 1, ivl: 2, queue: 2 },
        { reps: 3, lapses: 1, ivl: 4, queue: 2 },
        { reps: 7, lapses: 2, ivl: 10, queue: 2 },
        { reps: 2, lapses: 1, ivl: 1, queue: -1 },
    ])
    const app = bundle.exports.start(document.body)
    bundle.exports.flushSync()
    expect(Number(document.querySelector("[data-average]").textContent)).toBeCloseTo(0.85 / 3)

    const checkbox = document.querySelector("input[type=checkbox]")
    checkbox.click()
    bundle.exports.flushSync()
    expect(bundle.exports.includeValue()).toBe(true)
    expect(Number(document.querySelector("[data-average]").textContent)).toBeCloseTo(1.85 / 4)
    document.querySelector("[data-search]").click()
    expect(global.averageSearch).toBe("prop:reps>0 prop:lapses>=1 prop:lapses<3")
    bundle.exports.unmount(app)

    bundle.exports.setInclude(false)
    const repetitions = bundle.exports.start(document.body, {
        valueKind: "repetitions",
        allowDivideByLapses: true,
    })
    bundle.exports.flushSync()
    expect(Number(document.querySelector("[data-average]").textContent)).toBeCloseTo(13 / 3)
    document.querySelectorAll("input[type=checkbox]")[1].click()
    bundle.exports.flushSync()
    expect(Number(document.querySelector("[data-average]").textContent)).toBeCloseTo(16 / 9)
    bundle.exports.unmount(repetitions)
    dom.window.close()
}, 60_000)
