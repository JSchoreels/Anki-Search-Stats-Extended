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
    name: "daily-recall-gap-mocks",
    setup(build) {
        build.onResolve({ filter: /^daily-gap-test-entry$/ }, () => ({
            path: "entry",
            namespace: "test",
        }))
        build.onResolve({ filter: /^\.\// }, (args) => {
            if (
                [
                    "./stores",
                    "./i18n",
                    "./search",
                    "./statsWorkerClient",
                    "./MemorisedBar",
                    "./graph",
                    "./DailyPredictionGraph",
                    "./dragZoom",
                    "./revlogGraphs",
                    "./Warning.svelte",
                    "./AveragingControls.svelte",
                    "./ZoomControls.svelte",
                ].includes(args.path)
            )
                return { path: args.path, namespace: "test" }
        })
        build.onLoad({ filter: /.*/, namespace: "test" }, (args) => {
            let contents
            if (args.path === "entry") {
                contents = `import {mount, unmount, flushSync} from "svelte";
                    import Gap from "${project}/src/ts/DailyModelComparison.svelte";
                    import {createModelPredictionSources} from "${project}/src/ts/modelPredictionSources";
                    import {createDailyModelSources} from "${project}/src/ts/dailyModelSources";
                    import {calibration_samples, fsrsCalibrationStats, rwkvCalibrationStats} from "./stores";
                    export function start(target, props) {
                        calibration_samples.set(props.samples); fsrsCalibrationStats.set(props.fsrs); rwkvCalibrationStats.set(props.rwkv);
                        const modelPredictions = createModelPredictionSources(); modelPredictions.setSamples(props.samples);
                        const dailyModels = createDailyModelSources(); dailyModels.setSamples(props.samples);
                        return {app:mount(Gap,{target,props:{metric:"standardizedGap",...props,modelPredictions,dailyModels}}),modelPredictions,dailyModels};
                    }
                    export {unmount,flushSync};`
            } else if (args.path === "./stores") {
                contents = `import {writable} from "svelte/store";
                    export const revlogs = writable({id:"history"});
                    export const calibration_samples = writable(null), fsrsCalibrationStats = writable(null), rwkvCalibrationStats = writable(null);
                    export const tooltipShown = writable(false);`
            } else if (args.path === "./i18n") {
                contents = `export const i18n = (key,args) => key + (args ? " " + JSON.stringify(args) : "");`
            } else if (args.path === "./search") {
                contents = `export async function getRwkvUmPlusModelPages(model,ids,signal,progress) {
                    globalThis.modelLoads.push(model); progress({phase:"replaying",current:1,total:2,done:false});
                    if (globalThis.failedModel === model) {globalThis.failedModel = null; throw new Error("model missing");}
                    return model;
                }`
            } else if (args.path === "./statsWorkerClient") {
                contents = `export async function runStatsTask(task,args,signal) {
                    globalThis.tasks.push({task,args});
                    if(task === "dailyActualRecall") return {20000:{count:4,remembered:3}};
                    if(task === "calibrationPredictions") return {predictions:new Float64Array([globalThis.modelValues[args[1]]]),bins:[],warnings:[]};
                    if(task === "dailyPredictionData") return [{day:20000,count:1,actualRecall:1,predictedRecall:args[1][0],standardizedGap:0,logLoss:0}];
                    if(task === "dailyRecallModelReviewWindows") return Object.fromEntries(args[2].map(item => [item.model,[{day:20000,value:(0.75-item.predictions[0])*100}]]));
                    if(task === "dailyPredictionModelReviewWindows") return Object.fromEntries(args[1].map(item => [item.model,[{day:20000,value:-Math.log2(item.predictions[0])}]]));
                    throw new Error("Unexpected task "+task);
                }`
            } else if (args.path === "./MemorisedBar") {
                contents = `export const withConfidenceIntervals = bins => bins;`
            } else if (args.path === "./graph") {
                contents = `export const FSRS_COMPARISON_COLOUR="steelblue", RWKV_COMPARISON_COLOUR="seagreen";`
            } else if (args.path === "./DailyPredictionGraph") {
                contents = `export function renderDailyPredictionGraph(svg,series,metric,window,zoom,onZoom,options) {
                    globalThis.lastGraph={series,metric,window,options}; svg.dataset.models=series.map(item=>item.model).join(",");
                }`
            } else if (args.path === "./dragZoom") {
                contents = `export function dragZoom(){return {update(){},destroy(){}}}`
            } else if (args.path === "./revlogGraphs") {
                contents = `export const day_ms=86400000; export const dayFromMs = value => Math.floor(value/day_ms);`
            } else if (args.path === "./Warning.svelte") {
                contents = compile("<slot />", { filename: "Warning.svelte", generate: "client" })
                    .js.code
            } else if (args.path === "./AveragingControls.svelte") {
                contents = compile(
                    `<script>export let enabled,mode,days,reviews,connectGaps;</script>
                    <button data-review-window on:click={() => mode="reviews"}>Review window</button>`,
                    { filename: "AveragingControls.svelte", generate: "client" }
                ).js.code
            } else {
                contents = compile(`<script>export let zoomed,reset;</script>`, {
                    filename: "ZoomControls.svelte",
                    generate: "client",
                }).js.code
            }
            return { contents, loader: "js", resolveDir: project }
        })
    },
}

test("daily gap compares any selected models against all-day recall", async () => {
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
        tasks: [],
        lastGraph: null,
        failedModel: null,
        modelValues: {
            "rwkv-big": 0.3,
            "rwkv-small-curve": 0.4,
            "rwkv-small-instant": 0.5,
            "rwkv-tiny-instant": 0.6,
        },
    })
    const output = await esbuild.build({
        entryPoints: ["daily-gap-test-entry"],
        outfile: path.join(project, "daily-gap-test-bundle.js"),
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
    const { flushSync: flush } = bundle.exports
    const settle = async () => {
        for (let i = 0; i < 20; i++) {
            await Promise.resolve()
            flush()
        }
    }
    const samples = {
        revlogIds: new Float64Array([1]),
        cardIds: new Float64Array([1]),
        actual: new Uint8Array([1]),
    }
    const fsrs = { predictions: new Float64Array([0.8]), cachedPredictionCount: 1, warnings: [] }
    const rwkv = { predictions: new Float64Array([0.7]), warnings: [] }
    const point = (predictedRecall) => ({
        day: 20000,
        count: 1,
        actualRecall: 1,
        predictedRecall,
        standardizedGap: 0,
        logLoss: 0,
    })
    const comparison = { fsrsDaily: [point(0.8)], rwkvDaily: [point(0.7)] }
    const run = bundle.exports.start(document.body, { samples, fsrs, rwkv, comparison })
    await settle()
    const selects = [...document.querySelectorAll("select")]
    expect(selects).toHaveLength(2)
    expect(global.lastGraph.metric).toBe("rawGap")
    expect(
        global.lastGraph.series.map((item) => item.actualCount ?? item.data[0].actualCount)
    ).toEqual([4, 4])
    expect(global.lastGraph.series.map((item) => item.data[0].actualRecall)).toEqual([0.75, 0.75])
    expect(document.body.textContent).not.toContain("daily-prediction-show-raw-gap")
    const choose = async (index, value) => {
        selects[index].value = value
        selects[index].dispatchEvent(new window.Event("change", { bubbles: true }))
        await settle()
    }
    const models = ["fsrs", "rwkv", ...Object.keys(global.modelValues)]
    for (const first of models) {
        await choose(0, first)
        for (const second of models) {
            await choose(1, second)
            expect(global.lastGraph.series.map((item) => item.model)).toEqual([first, second])
            expect(global.lastGraph.metric).toBe("rawGap")
            expect(global.lastGraph.series.map((item) => item.data[0].actualRecall)).toEqual([
                0.75, 0.75,
            ])
            expect(global.lastGraph.series.map((item) => item.color)).toEqual([
                "steelblue",
                "seagreen",
            ])
            expect(global.lastGraph.series.map((item) => item.dashed)).toEqual([false, true])
        }
    }
    expect(global.modelLoads.slice().sort()).toEqual(Object.keys(global.modelValues).sort())
    await choose(0, "rwkv-big")
    await choose(1, "rwkv-tiny-instant")
    document.querySelector("[data-review-window]").click()
    await settle()
    const request = global.tasks
        .filter((item) => item.task === "dailyRecallModelReviewWindows")
        .at(-1)
    expect(request.args[2].map((item) => item.model)).toEqual(["rwkv-big", "rwkv-tiny-instant"])
    expect(global.lastGraph.options.reviewValues["rwkv-big"][0].value).toBeCloseTo(45)
    await choose(1, "none")
    expect(global.lastGraph.series.map((item) => item.model)).toEqual(["rwkv-big"])
    bundle.exports.unmount(run.app)
    run.modelPredictions.destroy()
    run.dailyModels.destroy()

    const missingFsrs = {
        predictions: new Float64Array([0.8]),
        cachedPredictionCount: 0,
        warnings: [],
    }
    const secondRun = bundle.exports.start(document.body, {
        samples,
        fsrs: missingFsrs,
        rwkv: null,
        comparison: null,
    })
    await settle()
    expect(document.body.textContent).toContain("daily-prediction-no-data")
    global.failedModel = "rwkv-small-curve"
    const secondSelects = [...document.querySelectorAll("select")]
    for (const [index, value] of [
        [0, "rwkv-big"],
        [1, "rwkv-small-curve"],
    ]) {
        secondSelects[index].value = value
        secondSelects[index].dispatchEvent(new window.Event("change", { bubbles: true }))
        await settle()
    }
    expect(document.body.textContent).toContain("model missing")
    const retry = [...document.querySelectorAll("button")].find((button) =>
        button.textContent.includes("model-retry")
    )
    retry.click()
    await settle()
    expect(global.lastGraph.series.map((item) => item.model)).toEqual([
        "rwkv-big",
        "rwkv-small-curve",
    ])
    bundle.exports.unmount(secondRun.app)
    secondRun.modelPredictions.destroy()
    secondRun.dailyModels.destroy()

    global.tasks = []
    global.modelLoads = []
    const lossRun = bundle.exports.start(document.body, {
        metric: "logLoss",
        samples,
        fsrs,
        rwkv,
        comparison,
    })
    await settle()
    const lossSelects = [...document.querySelectorAll("select")]
    expect(lossSelects.map((select) => select.value)).toEqual(["fsrs", "rwkv"])
    expect(global.lastGraph.metric).toBe("logLoss")
    expect(global.lastGraph.series.map((item) => item.data[0].actualRecall)).toEqual([1, 1])
    expect(global.tasks.some((item) => item.task === "dailyActualRecall")).toBe(false)
    for (const first of models) {
        lossSelects[0].value = first
        lossSelects[0].dispatchEvent(new window.Event("change", { bubbles: true }))
        await settle()
        for (const second of models) {
            lossSelects[1].value = second
            lossSelects[1].dispatchEvent(new window.Event("change", { bubbles: true }))
            await settle()
            expect(global.lastGraph.series.map((item) => item.model)).toEqual([first, second])
            expect(global.lastGraph.series.map((item) => item.color)).toEqual([
                "steelblue",
                "seagreen",
            ])
            expect(global.lastGraph.series.map((item) => item.dashed)).toEqual([false, true])
        }
    }
    lossSelects[0].value = "rwkv-big"
    lossSelects[0].dispatchEvent(new window.Event("change", { bubbles: true }))
    lossSelects[1].value = "rwkv-tiny-instant"
    lossSelects[1].dispatchEvent(new window.Event("change", { bubbles: true }))
    await settle()
    document.querySelector("[data-review-window]").click()
    await settle()
    const lossRequest = global.tasks
        .filter((item) => item.task === "dailyPredictionModelReviewWindows")
        .at(-1)
    expect(lossRequest.args[1].map((item) => item.model)).toEqual(["rwkv-big", "rwkv-tiny-instant"])
    expect(lossRequest.args[2]).toBe("logLoss")
    expect(global.lastGraph.options.reviewValues["rwkv-big"][0].value).toBeCloseTo(-Math.log2(0.3))
    lossSelects[1].value = "none"
    lossSelects[1].dispatchEvent(new window.Event("change", { bubbles: true }))
    await settle()
    expect(global.lastGraph.series.map((item) => item.model)).toEqual(["rwkv-big"])
    bundle.exports.unmount(lossRun.app)
    lossRun.modelPredictions.destroy()
    lossRun.dailyModels.destroy()
    dom.window.close()
})
