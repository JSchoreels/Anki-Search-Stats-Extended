/** @jest-environment node */
const path = require("node:path")
const esbuild = require("esbuild")
const sveltePlugin = require("esbuild-svelte")
const { sveltePreprocess } = require("svelte-preprocess")
const { compile } = require("svelte/compiler")
const { JSDOM } = require("jsdom")

const project = path.resolve(__dirname, "..")
const plugin = {
    name: "um-plus-component-mocks",
    setup(build) {
        build.onResolve({ filter: /^um-plus-test-entry$/ }, () => ({
            path: "entry",
            namespace: "test",
        }))
        build.onResolve({ filter: /^\.\// }, (args) => {
            if (
                [
                    "./UMPlus.svelte",
                    "./Warning.svelte",
                    "./i18n",
                    "./search",
                    "./statsWorkerClient",
                ].includes(args.path)
            )
                return { path: args.path, namespace: "test" }
        })
        build.onLoad({ filter: /.*/, namespace: "test" }, (args) => {
            let contents
            if (args.path === "entry") {
                contents = `import { mount, unmount, flushSync } from "svelte";
                    import App from "${project}/src/ts/UMPlusComparison.svelte";
                    export const start = (target, props) => mount(App, { target, props });
                    export { unmount, flushSync };`
            } else if (args.path === "./UMPlus.svelte") {
                contents = compile(
                    `<script>export let data; export let firstModel; export let secondModel;</script>
                    <p class="model-result">{firstModel} vs {secondModel}: {data.count}</p>`,
                    { filename: "UMPlus.svelte", generate: "client" }
                ).js.code
            } else if (args.path === "./Warning.svelte") {
                contents = compile("<slot />", { filename: "Warning.svelte", generate: "client" })
                    .js.code
            } else if (args.path === "./i18n") {
                contents = `export function i18n(key, args) { return key + (args?.error ? ": " + args.error : ""); }`
            } else if (args.path === "./search") {
                contents = `export async function getRwkvUmPlusModelPages(model, ids, signal, progress) {
                    globalThis.modelLoads.push(model);
                    progress({phase:"replaying", current:1, total:2, done:false});
                    return model;
                }`
            } else {
                contents = `export async function runStatsTask(task, args) {
                    if (task === "calibrationPredictions") {
                        return { predictions: new Float64Array([globalThis.modelValues[args[1]]]), warnings: [] };
                    }
                    globalThis.modelPairs.push([Array.from(args[1]), Array.from(args[2])]);
                    return { count: 1, bins: [], disagreementPercentiles: [] };
                }`
            }
            return { contents, loader: "js", resolveDir: project }
        })
    },
}

test("model selectors load and compare each requested model on the chosen side", async () => {
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
        modelLoads: [],
        modelPairs: [],
        modelValues: {
            "rwkv-big": 0.3,
            "rwkv-small-curve": 0.4,
            "rwkv-small-instant": 0.5,
            "rwkv-tiny-instant": 0.6,
        },
    })
    const output = await esbuild.build({
        entryPoints: ["um-plus-test-entry"],
        outfile: path.join(project, "um-plus-test-bundle.js"),
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
    const flush = bundle.exports.flushSync
    const settle = async () => {
        for (let i = 0; i < 12; i++) {
            await Promise.resolve()
            flush()
        }
    }
    const app = bundle.exports.start(document.body, {
        samples: {
            revlogIds: new Float64Array([1]),
            cardIds: new Float64Array([10]),
            actual: new Uint8Array([1]),
        },
        fsrs: { cachedPredictionCount: 0, predictions: new Float64Array([0.9]), warnings: [] },
        rwkv: { predictions: new Float64Array([0.8]), warnings: [] },
        comparison: { umPlus: { count: 1, bins: [], disagreementPercentiles: [] } },
        fsrsGenerating: false,
    })
    flush()
    const [first, second] = document.querySelectorAll("select")
    expect([...first.options].map((option) => option.value)).toEqual([
        "fsrs",
        "rwkv",
        "rwkv-big",
        "rwkv-small-curve",
        "rwkv-small-instant",
        "rwkv-tiny-instant",
    ])
    expect(document.body.textContent).toContain("um-plus-fsrs-held-out-unavailable")

    first.value = "rwkv-big"
    first.dispatchEvent(new window.Event("change", { bubbles: true }))
    second.value = "rwkv-small-instant"
    second.dispatchEvent(new window.Event("change", { bubbles: true }))
    flush()
    await settle()
    expect(global.modelLoads).toEqual(["rwkv-big", "rwkv-small-instant"])
    expect(global.modelPairs.at(-1)).toEqual([[0.3], [0.5]])
    expect(document.querySelector(".model-result").textContent).toContain(
        "rwkv-big vs um-plus-model-rwkv-small-instant"
    )

    first.value = "rwkv-small-curve"
    first.dispatchEvent(new window.Event("change", { bubbles: true }))
    second.value = "rwkv-tiny-instant"
    second.dispatchEvent(new window.Event("change", { bubbles: true }))
    flush()
    await settle()
    expect(global.modelPairs.at(-1)).toEqual([[0.4], [0.6]])
    first.value = "rwkv-big"
    first.dispatchEvent(new window.Event("change", { bubbles: true }))
    flush()
    await settle()
    expect(global.modelLoads.filter((model) => model === "rwkv-big")).toHaveLength(1)
    expect(global.modelPairs.at(-1)).toEqual([[0.3], [0.6]])
    bundle.exports.unmount(app)

    global.modelLoads = []
    global.modelPairs = []
    const secondApp = bundle.exports.start(document.body, {
        samples: {
            revlogIds: new Float64Array([1]),
            cardIds: new Float64Array([10]),
            actual: new Uint8Array([1]),
        },
        fsrs: { cachedPredictionCount: 1, predictions: new Float64Array([0.9]), warnings: [] },
        rwkv: { predictions: new Float64Array([0.8]), warnings: [] },
        comparison: { umPlus: { count: 1, bins: [], disagreementPercentiles: [] } },
        fsrsGenerating: false,
    })
    flush()
    const [firstChoice, secondChoice] = document.querySelectorAll("select")
    const values = { fsrs: 0.9, rwkv: 0.8, ...global.modelValues }
    for (const left of Object.keys(values)) {
        for (const right of Object.keys(values)) {
            firstChoice.value = left
            firstChoice.dispatchEvent(new window.Event("change", { bubbles: true }))
            secondChoice.value = right
            secondChoice.dispatchEvent(new window.Event("change", { bubbles: true }))
            flush()
            await settle()
            expect(document.querySelector(".model-result")).not.toBeNull()
            if (left !== "fsrs" || right !== "rwkv") {
                expect(global.modelPairs.at(-1)).toEqual([[values[left]], [values[right]]])
            }
        }
    }
    expect(global.modelLoads.sort()).toEqual(Object.keys(global.modelValues).sort())
    bundle.exports.unmount(secondApp)
    dom.window.close()
})
