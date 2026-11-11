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
                    "./ROCGraph",
                    "./FSRSCalibration.svelte",
                    "./FsrsCalibrationStatus.svelte",
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
                    import App from "${project}/src/ts/ModelComparison.svelte";
                    import Calibration from "${project}/src/ts/ModelCalibration.svelte";
                    import { createModelPredictionSources } from "${project}/src/ts/modelPredictionSources";
                    export const sources = samples => {
                        const modelPredictions = createModelPredictionSources();
                        modelPredictions.setSamples(samples);
                        return modelPredictions;
                    };
                    export const start = (target, props, modelPredictions = sources(props.samples)) =>
                        mount(App, { target, props: { ...props, kind: "umPlus", modelPredictions } });
                    export const startROC = (target, props, modelPredictions = sources(props.samples)) =>
                        mount(App, { target, props: { ...props, kind: "roc", modelPredictions } });
                    export const startCalibration = (target, props, modelPredictions) =>
                        mount(Calibration, { target, props: { ...props, modelPredictions } });
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
            } else if (args.path === "./ROCGraph") {
                contents = `export function renderRocGraph(svg, data, options) {
                    svg.dataset.first = options.firstModel; svg.dataset.second = options.secondModel;
                }`
            } else if (args.path === "./FSRSCalibration.svelte") {
                contents = compile(
                    `<script>export let data; export let series;</script>
                    <div class="calibration-result">{#each series as item}
                    <span data-model={item.label} data-bands={!!item.bins[0]?.confidenceInterval} data-predicted={item.bins[0]?.predicted}>{item.label}</span>
                    {/each}</div>`,
                    { filename: "FSRSCalibration.svelte", generate: "client" }
                ).js.code
            } else if (args.path === "./FsrsCalibrationStatus.svelte") {
                contents = compile("<div></div>", {
                    filename: "FsrsCalibrationStatus.svelte",
                    generate: "client",
                }).js.code
            } else if (args.path === "./i18n") {
                contents = `export function i18n(key, args) {
                    if (key === "roc-auc-difference") return "AUC (" + args.first + " − " + args.second + "): " + args.difference;
                    return key + (args?.error ? ": " + args.error : "");
                }`
            } else if (args.path === "./search") {
                contents = `export async function getRwkvUmPlusModelPages(model, ids, signal, progress) {
                    globalThis.modelLoads.push(model);
                    progress({phase:"replaying", current:1, total:2, done:false});
                    if (globalThis.failNextModel === model) { globalThis.failNextModel = null; throw new Error("model unavailable"); }
                    if (globalThis.holdModel === model) await new Promise(resolve => { globalThis.releaseModel = resolve; });
                    return model;
                }`
            } else {
                contents = `export async function runStatsTask(task, args) {
                    if (task === "calibrationPredictions") {
                        const value = globalThis.modelValues[args[1]];
                        return { predictions: new Float64Array([value]), bins: [{real:1, predicted:value, count:1}], warnings: [] };
                    }
                    if (task === "calibrationBands") { globalThis.bandCalls++; return [[0.2, 0.8]]; }
                    if (task === "roc") {
                        globalThis.rocPairs.push([Array.from(args[1]), Array.from(args[2])]);
                        return {count:2, positiveCount:globalThis.rocPositiveCount, negativeCount:1,
                            difference:{value:0.25,interval:{lower:-0.1,upper:0.6}}};
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
        rocPairs: [],
        rocPositiveCount: 1,
        bandCalls: 0,
        failNextModel: null,
        holdModel: null,
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
    expect(document.body.textContent).toContain("model-fsrs-held-out-unavailable")

    first.value = "rwkv-big"
    first.dispatchEvent(new window.Event("change", { bubbles: true }))
    second.value = "rwkv-small-instant"
    second.dispatchEvent(new window.Event("change", { bubbles: true }))
    flush()
    await settle()
    expect(global.modelLoads).toEqual(["rwkv-big", "rwkv-small-instant"])
    expect(global.modelPairs.at(-1)).toEqual([[0.3], [0.5]])
    expect(document.querySelector(".model-result").textContent).toContain(
        "rwkv-big vs model-rwkv-small-instant"
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

    global.modelLoads = []
    global.bandCalls = 0
    const samples = {
        revlogIds: new Float64Array([1]),
        cardIds: new Float64Array([10]),
        actual: new Uint8Array([1]),
    }
    const fsrs = {
        cachedPredictionCount: 1,
        predictions: new Float64Array([0.9]),
        bins: [{ real: 1, predicted: 0.9, count: 1 }],
        warnings: [],
    }
    const rwkv = {
        predictions: new Float64Array([0.8]),
        bins: [{ real: 1, predicted: 0.8, count: 1 }],
        warnings: [],
    }
    const shared = bundle.exports.sources(samples)
    const umTarget = document.createElement("div")
    const calibrationTarget = document.createElement("div")
    document.body.append(umTarget, calibrationTarget)
    const umApp = bundle.exports.start(
        umTarget,
        {
            samples,
            fsrs,
            rwkv,
            comparison: { umPlus: { count: 1, bins: [], disagreementPercentiles: [] } },
            fsrsGenerating: false,
        },
        shared
    )
    const calibrationApp = bundle.exports.startCalibration(
        calibrationTarget,
        {
            samples,
            fsrs,
            rwkv,
            fallbackFsrsBins: [],
        },
        shared
    )
    flush()
    const [umFirst] = umTarget.querySelectorAll("select")
    umFirst.value = "rwkv-big"
    umFirst.dispatchEvent(new window.Event("change", { bubbles: true }))
    flush()
    await settle()
    expect(global.modelLoads).toEqual(["rwkv-big"])
    expect(global.bandCalls).toBe(0)
    expect(
        [...calibrationTarget.querySelectorAll("[data-model]")].map((item) => item.dataset.model)
    ).toEqual(["calibration-source-fsrs"])

    const [calibrationFirst, calibrationSecond] = calibrationTarget.querySelectorAll("select")
    expect(calibrationSecond.value).toBe("none")
    calibrationSecond.value = "rwkv-big"
    calibrationSecond.dispatchEvent(new window.Event("change", { bubbles: true }))
    flush()
    await settle()
    expect(global.modelLoads).toEqual(["rwkv-big"])
    expect(global.bandCalls).toBe(1)
    expect(
        [...calibrationTarget.querySelectorAll("[data-model]")].map((item) => item.dataset.model)
    ).toEqual(["calibration-source-fsrs", "model-rwkv-big"])
    expect(calibrationTarget.querySelector('[data-model="model-rwkv-big"]').dataset.bands).toBe(
        "true"
    )

    calibrationFirst.value = "rwkv-small-curve"
    calibrationFirst.dispatchEvent(new window.Event("change", { bubbles: true }))
    calibrationSecond.value = "rwkv-tiny-instant"
    calibrationSecond.dispatchEvent(new window.Event("change", { bubbles: true }))
    flush()
    await settle()
    expect(
        [...calibrationTarget.querySelectorAll("[data-model]")].map((item) => item.dataset.model)
    ).toEqual(["model-rwkv-small-curve", "model-rwkv-tiny-instant"])
    expect(global.bandCalls).toBe(3)
    const labels = {
        fsrs: "calibration-source-fsrs",
        rwkv: "model-rwkv-current",
        ...Object.fromEntries(
            Object.keys(global.modelValues).map((name) => [name, `model-${name}`])
        ),
    }
    for (const left of Object.keys(labels)) {
        for (const right of ["none", ...Object.keys(labels)]) {
            calibrationFirst.value = left
            calibrationFirst.dispatchEvent(new window.Event("change", { bubbles: true }))
            calibrationSecond.value = right
            calibrationSecond.dispatchEvent(new window.Event("change", { bubbles: true }))
            flush()
            await settle()
            expect(
                [...calibrationTarget.querySelectorAll("[data-model]")].map(
                    (item) => item.dataset.model
                )
            ).toEqual(right === "none" ? [labels[left]] : [labels[left], labels[right]])
        }
    }
    expect(global.modelLoads.sort()).toEqual(Object.keys(global.modelValues).sort())
    expect(global.bandCalls).toBe(4)
    umFirst.value = "rwkv-tiny-instant"
    umFirst.dispatchEvent(new window.Event("change", { bubbles: true }))
    flush()
    await settle()
    expect(global.modelLoads.sort()).toEqual(Object.keys(global.modelValues).sort())
    const rocTarget = document.createElement("div")
    document.body.append(rocTarget)
    const defaultRoc = {
        count: 2,
        positiveCount: 1,
        negativeCount: 1,
        difference: { value: 0.1, interval: { lower: -0.2, upper: 0.3 } },
    }
    const rocApp = bundle.exports.startROC(
        rocTarget,
        {
            samples,
            fsrs,
            rwkv,
            comparison: { roc: defaultRoc },
            fsrsGenerating: false,
        },
        shared
    )
    flush()
    const [rocFirst, rocSecond] = rocTarget.querySelectorAll("select")
    expect(rocTarget.querySelector("svg").dataset.first).toBe(labels.fsrs)
    expect(rocTarget.querySelector("svg").dataset.second).toBe(labels.rwkv)
    for (const left of Object.keys(values)) {
        for (const right of Object.keys(values)) {
            rocFirst.value = left
            rocFirst.dispatchEvent(new window.Event("change", { bubbles: true }))
            rocSecond.value = right
            rocSecond.dispatchEvent(new window.Event("change", { bubbles: true }))
            flush()
            await settle()
            const graph = rocTarget.querySelector("svg")
            expect(graph.dataset.first).toBe(labels[left])
            expect(graph.dataset.second).toBe(labels[right])
            expect(rocTarget.querySelector(".roc-difference").textContent).toContain(
                `AUC (${labels[left]} − ${labels[right]})`
            )
            if (left !== "fsrs" || right !== "rwkv") {
                expect(global.rocPairs.at(-1)).toEqual([[values[left]], [values[right]]])
            }
        }
    }
    expect(global.modelLoads.sort()).toEqual(Object.keys(global.modelValues).sort())
    expect(global.bandCalls).toBe(4)
    global.rocPositiveCount = 0
    rocFirst.value = "rwkv-big"
    rocFirst.dispatchEvent(new window.Event("change", { bubbles: true }))
    flush()
    await settle()
    expect(rocTarget.querySelector("svg")).toBeNull()
    expect(rocTarget.textContent).toContain("roc-no-data")
    global.rocPositiveCount = 1
    bundle.exports.unmount(rocApp)
    bundle.exports.unmount(umApp)
    bundle.exports.unmount(calibrationApp)
    shared.destroy()

    const fallback = bundle.exports.sources(samples)
    const fallbackApp = bundle.exports.startCalibration(
        calibrationTarget,
        {
            samples,
            fsrs: { ...fsrs, bins: [] },
            rwkv,
            fallbackFsrsBins: [{ real: 1, predicted: 0.7, count: 1 }],
        },
        fallback
    )
    flush()
    expect(
        calibrationTarget.querySelector('[data-model="calibration-source-fsrs"]').dataset.predicted
    ).toBe("0.7")
    bundle.exports.unmount(fallbackApp)
    fallback.destroy()

    const pendingSources = bundle.exports.sources(samples)
    const pendingApp = bundle.exports.startCalibration(
        calibrationTarget,
        {
            samples,
            fsrs,
            rwkv,
            fallbackFsrsBins: [],
        },
        pendingSources
    )
    flush()
    const pendingSecond = calibrationTarget.querySelectorAll("select")[1]
    global.holdModel = "rwkv-small-curve"
    pendingSecond.value = "rwkv-small-curve"
    pendingSecond.dispatchEvent(new window.Event("change", { bubbles: true }))
    flush()
    await settle()
    expect(calibrationTarget.querySelector('[data-model="calibration-source-fsrs"]')).not.toBeNull()
    expect(calibrationTarget.textContent).toContain("model-preparing")
    global.holdModel = null
    global.releaseModel()
    await settle()
    expect(calibrationTarget.querySelector('[data-model="model-rwkv-small-curve"]')).not.toBeNull()

    global.failNextModel = "rwkv-big"
    pendingSecond.value = "rwkv-big"
    pendingSecond.dispatchEvent(new window.Event("change", { bubbles: true }))
    flush()
    await settle()
    expect(calibrationTarget.querySelector('[data-model="calibration-source-fsrs"]')).not.toBeNull()
    expect(calibrationTarget.textContent).toContain("model unavailable")
    calibrationTarget.querySelector("button").click()
    flush()
    await settle()
    expect(calibrationTarget.querySelector('[data-model="model-rwkv-big"]')).not.toBeNull()
    bundle.exports.unmount(pendingApp)
    pendingSources.destroy()

    const missingSource = bundle.exports.sources(samples)
    const missingApp = bundle.exports.startROC(
        rocTarget,
        {
            samples,
            fsrs: { ...fsrs, cachedPredictionCount: 0 },
            rwkv,
            comparison: { roc: defaultRoc },
            fsrsGenerating: false,
        },
        missingSource
    )
    flush()
    expect(rocTarget.textContent).toContain("model-fsrs-held-out-unavailable")
    const [missingFirst, missingSecond] = rocTarget.querySelectorAll("select")
    missingFirst.value = "rwkv-big"
    missingFirst.dispatchEvent(new window.Event("change", { bubbles: true }))
    missingSecond.value = "rwkv-small-instant"
    missingSecond.dispatchEvent(new window.Event("change", { bubbles: true }))
    flush()
    await settle()
    expect(rocTarget.querySelector("svg").dataset.first).toBe(labels["rwkv-big"])
    expect(rocTarget.querySelector("svg").dataset.second).toBe(labels["rwkv-small-instant"])
    bundle.exports.unmount(missingApp)
    missingSource.destroy()
    dom.window.close()
})
