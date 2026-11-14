/** @jest-environment node */
const path = require("node:path")
const esbuild = require("esbuild")
const sveltePlugin = require("esbuild-svelte")
const { sveltePreprocess } = require("svelte-preprocess")
const { compile } = require("svelte/compiler")
const { JSDOM } = require("jsdom")

const project = path.resolve(__dirname, "..")
const plugin = {
    name: "memorised-trend-mocks",
    setup(build) {
        build.onResolve({ filter: /^trend-test-entry$/ }, () => ({
            path: "entry",
            namespace: "test",
        }))
        build.onResolve({ filter: /^trend-test-wrapper$/ }, () => ({
            path: "wrapper",
            namespace: "test",
        }))
        build.onResolve({ filter: /^\.\// }, (args) => {
            if (
                [
                    "./LineGraph",
                    "./dragZoom",
                    "./ZoomControls.svelte",
                    "./trendSession",
                    "./trendPinnedPersistence",
                ].includes(args.path)
            )
                return { path: args.path, namespace: "test" }
        })
        build.onLoad({ filter: /.*/, namespace: "test" }, (args) => {
            let contents
            if (args.path === "entry") {
                contents = `import { mount, unmount, flushSync } from "svelte"; import App from "trend-test-wrapper";
                    export const start=(target,preserve)=>mount(App,{target,props:{preserve}}); export {unmount,flushSync};`
            } else if (args.path === "wrapper") {
                contents = compile(
                    `<script>import Graph from "${project}/src/ts/LineGraph.svelte"; export let preserve=true; let key="cards";</script>
                    <button data-switch on:click={() => key="notes"}>Switch</button>
                    <Graph label="memorised" data={[1,2]} trendPersistenceKey={key} preserveTrendsOnKeyChange={preserve} />`,
                    { filename: "TrendWrapper.svelte", generate: "client" }
                ).js.code
            } else if (args.path === "./LineGraph") {
                contents = `export function renderLineChart(svg,data,label,options) {
                    globalThis.trendRenders.push(options.initialTrends.map(t => ({...t})));
                    const trends=options.initialTrends.length ? options.initialTrends.map((t,i)=>({...t,id:i+1})) :
                        (globalThis.trendRenders.length===1 ? [{id:1,startX:1,endX:2,colour:"red",pinned:false,kind:"custom"}] : []);
                    options.onTrendsChange(trends); return {};
                }`
            } else if (args.path === "./dragZoom") {
                contents = `export const dragZoom=()=>({update(){},destroy(){}});`
            } else if (args.path === "./ZoomControls.svelte") {
                contents = compile(`<script>export let zoomed, reset;</script>`, {
                    filename: "ZoomControls.svelte",
                    generate: "client",
                }).js.code
            } else if (args.path === "./trendSession") {
                contents = `export const mergeVisibleCustomTrends=(all,visible)=>visible.map(({id,...rest})=>rest);
                    export const hiddenPinnedRanges=()=>[]; export const mergeTrendRanges=(a,b)=>[...a,...b]; export const removeTrendFromAll=(a)=>a;`
            } else if (args.path === "./trendPinnedPersistence") {
                contents = `export const loadPinnedTrendRanges=()=>({initialPinnedRanges:[]});
                    export const queuePersistPinnedRanges=async()=>true, queuePersistStoredPinnedRanges=async()=>true;`
            }
            return { contents, loader: "js", resolveDir: project }
        })
    },
}

test("memorised mode switches retain active trends without changing other graphs", async () => {
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
        entryPoints: ["trend-test-entry"],
        outfile: path.join(project, "trend-test-bundle.js"),
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

    for (const preserve of [true, false]) {
        global.trendRenders = []
        const app = bundle.exports.start(document.body, preserve)
        bundle.exports.flushSync()
        document.querySelector("[data-switch]").click()
        bundle.exports.flushSync()
        expect(global.trendRenders.at(-1)).toHaveLength(preserve ? 1 : 0)
        bundle.exports.unmount(app)
    }
    dom.window.close()
})
