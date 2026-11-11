/** @jest-environment node */
const path = require("node:path")
const esbuild = require("esbuild")
const sveltePlugin = require("esbuild-svelte")
const { sveltePreprocess } = require("svelte-preprocess")
const { compile } = require("svelte/compiler")
const { JSDOM } = require("jsdom")
jest.setTimeout(30000)

const project = path.resolve(__dirname, "..")
const plugin = {
    name: "current-disagreement-test-mocks",
    setup(build) {
        build.onResolve({ filter: /^current-disagreement-test-entry$/ }, () => ({
            path: "entry",
            namespace: "test",
        }))
        build.onResolve({ filter: /^\.\// }, (args) => {
            if (
                [
                    "./GraphContainer.svelte",
                    "./GraphSvg.svelte",
                    "./CurrentRetrievability.svelte",
                    "./graphVisibility",
                    "./stores",
                    "./i18n",
                    "./search",
                    "./modelPredictionSources",
                    "./CurrentDisagreementGraph",
                ].includes(args.path)
            )
                return { path: args.path, namespace: "test" }
        })
        build.onLoad({ filter: /.*/, namespace: "test" }, (args) => {
            let contents
            if (args.path === "entry") {
                contents = `import {mount, unmount, flushSync} from "svelte";
                    import App from "${project}/src/ts/CurrentDisagreement.svelte";
                    import {cids} from "./stores";
                    export const start = target => mount(App, {target});
                    export {unmount, flushSync, cids};`
            } else if (args.path === "./GraphContainer.svelte") {
                contents = compile(
                    `<script>export let graphId;</script><section data-graph={graphId}><slot /></section>`,
                    { filename: "GraphContainer.svelte", generate: "client" }
                ).js.code
            } else if (args.path === "./GraphSvg.svelte") {
                contents = compile(
                    `<script>export let render; let svg; $: if (svg) render(svg);</script><svg bind:this={svg}></svg>`,
                    { filename: "GraphSvg.svelte", generate: "client" }
                ).js.code
            } else if (args.path === "./CurrentRetrievability.svelte") {
                contents = compile(
                    `<script>export let response; export let retry;</script><aside>{response?.status}</aside>`,
                    { filename: "CurrentRetrievability.svelte", generate: "client" }
                ).js.code
            } else if (args.path === "./graphVisibility") {
                contents = `import {readable} from "svelte/store"; export const graphVisibility = () => readable(true);`
            } else if (args.path === "./stores") {
                contents = `import {writable} from "svelte/store"; export const cids = writable([1,2,3,4]);`
            } else if (args.path === "./i18n") {
                contents = `export const i18n = (key, args) => key + (args ? " " + JSON.stringify(args) : "");`
            } else if (args.path === "./search") {
                contents = `export async function getCurrentCardDisagreement(ids) {
                    globalThis.baseLoads.push([...ids]); return globalThis.baseResponse;
                }
                export async function getCurrentFsrsModelPredictions(ids, signal) {
                    globalThis.fsrsLoads.push([...ids]); return {status:"ready",data:globalThis.currentScores.fsrs};
                }
                export async function getCurrentRwkvModelPredictions(model, ids, signal, progress) {
                    globalThis.currentLoads.push(model);
                    progress({phase:"replaying",current:1,total:2,done:false});
                    if (globalThis.failModel === model) { globalThis.failModel = null; throw new Error("missing model"); }
                    return globalThis.currentScores[model];
                }`
            } else if (args.path === "./modelPredictionSources") {
                contents = `export const isRwkvModel = id => id.startsWith("rwkv-");
                    export const modelOptions = () => ["fsrs","rwkv","rwkv-big","rwkv-small-curve","rwkv-small-instant","rwkv-tiny-instant"].map(id => ({id,label:id}));`
            } else {
                contents = `export function renderCurrentDisagreementGraph(svg, bins, first, second) {
                    svg.dataset.first = first; svg.dataset.second = second;
                    svg.dataset.bins = JSON.stringify(bins.map(bin => [bin.center,bin.cids]));
                }`
            }
            return { contents, loader: "js", resolveDir: project }
        })
    },
}

test("current disagreement selectors compare every ordered model pair", async () => {
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
        baseLoads: [],
        fsrsLoads: [],
        currentLoads: [],
        failModel: null,
        currentScores: {
            fsrs: [
                [1, 0.8],
                [2, 0.7],
                [4, 0.3],
            ],
            rwkv: [
                [1, 0.4],
                [2, 0.6],
                [3, 0.7],
            ],
            "rwkv-big": [
                [1, 0.2],
                [3, 0.6],
                [4, 0.8],
            ],
            "rwkv-small-curve": [
                [1, 0.9],
                [2, 0.3],
                [3, 0.4],
            ],
            "rwkv-small-instant": [
                [1, 0.5],
                [2, 0.2],
                [4, 0.9],
            ],
            "rwkv-tiny-instant": [
                [1, 0.6],
                [3, 0.2],
                [4, 0.1],
            ],
        },
        baseResponse: {
            status: "ready",
            total: 4,
            rwkvStatus: "ready",
            rwkvScores: [
                [1, 0.4],
                [2, 0.6],
                [3, 0.7],
            ],
            rows: [
                { cid: 1, fsrs: 0.8, rwkv: 0.4 },
                { cid: 2, fsrs: 0.7, rwkv: 0.6 },
            ],
        },
    })
    const output = await esbuild.build({
        entryPoints: ["current-disagreement-test-entry"],
        outfile: path.join(project, "current-disagreement-test-bundle.js"),
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
    const { flushSync: flush, cids } = bundle.exports
    const settle = async () => {
        for (let i = 0; i < 20; i++) {
            await Promise.resolve()
            flush()
        }
    }
    const app = bundle.exports.start(document.body)
    await settle()
    const selects = [...document.querySelectorAll("select")]
    expect(selects).toHaveLength(2)
    expect(global.fsrsLoads).toHaveLength(0)
    const select = async (index, value) => {
        selects[index].value = value
        selects[index].dispatchEvent(new window.Event("change", { bubbles: true }))
        await settle()
    }
    const models = Object.keys(global.currentScores)
    for (const first of models) {
        await select(0, first)
        for (const second of models) {
            await select(1, second)
            const svg = document.querySelector("svg")
            expect(svg?.dataset.first).toBe(first)
            expect(svg?.dataset.second).toBe(second)
            const actual = JSON.parse(svg.dataset.bins)
                .flatMap(([, ids]) => ids)
                .sort()
            const secondIds = new Set(global.currentScores[second].map(([cid]) => cid))
            const expected = global.currentScores[first]
                .map(([cid]) => cid)
                .filter((cid) => secondIds.has(cid))
                .sort()
            expect(actual).toEqual(expected)
        }
    }
    expect(global.currentLoads.slice().sort()).toEqual(
        models.filter((model) => model.startsWith("rwkv-")).sort()
    )
    expect(global.fsrsLoads).toHaveLength(1)

    global.baseResponse = {
        status: "pending",
        total: 4,
        rwkvStatus: "pending",
        rwkvScores: [],
        rows: [],
    }
    cids.set([1, 2, 3, 4])
    await settle()
    await select(0, "rwkv-big")
    await select(1, "rwkv-small-curve")
    expect(document.querySelector("svg")?.dataset.first).toBe("rwkv-big")
    expect(document.querySelector("aside").textContent).toBe("pending")
    await select(0, "fsrs")
    await select(1, "rwkv-big")
    expect(document.querySelector("svg")?.dataset.first).toBe("fsrs")
    expect(document.querySelector("aside").textContent).toBe("pending")

    global.failModel = "rwkv-tiny-instant"
    cids.set([1, 2, 3, 4])
    await settle()
    await select(1, "rwkv-tiny-instant")
    expect(document.body.textContent).toContain("missing model")
    document.querySelector('section[data-graph="fsrs:current-disagreement"] button').click()
    await settle()
    expect(document.querySelector("svg")?.dataset.second).toBe("rwkv-tiny-instant")

    bundle.exports.unmount(app)
    dom.window.close()
})
