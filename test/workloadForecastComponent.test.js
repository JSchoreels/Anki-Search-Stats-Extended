/** @jest-environment node */
const path = require("node:path")
const esbuild = require("esbuild")
const sveltePlugin = require("esbuild-svelte")
const { sveltePreprocess } = require("svelte-preprocess")
const { compile } = require("svelte/compiler")
const { JSDOM } = require("jsdom")

const project = path.resolve(__dirname, "..")
const band = (value) => ({ mean: value, p1: value, p5: value, p50: value, p95: value, p99: value })
const result = {
    version: 1,
    days: 1,
    paths: 20,
    cards: 2000,
    daily: [
        {
            day: 0,
            due: band(1800),
            done: band(100),
            new: band(0),
            lapses: band(10),
            seconds: band(1200),
        },
    ],
}

const mocks = {
    "./i18n": "export const i18n = (key) => key",
    "./stores": `export const searchString = { subscribe(fn) { fn("deck:current"); return () => {}; } };
        export const tooltip = { set() {} }; export const tooltipShown = { set() {} };`,
    "./search": `export async function getWorkloadForecastAvailable() { return true; }
        export async function startWorkloadForecast(request) { globalThis.forecastRequest = request; return globalThis.forecastStream ? { job_id: 1, phase: "running" } : { job_id: 1, phase: "complete", result: { ...${JSON.stringify(result)}, paths: request.paths } }; }
        export async function getWorkloadForecastProgress() { return globalThis.forecastPollResult; }
        export async function cancelWorkloadForecast() {}`,
}

const mockPlugin = {
    name: "forecast-component-mocks",
    setup(build) {
        build.onResolve({ filter: /^forecast-test-entry$/ }, () => ({
            path: "entry",
            namespace: "test",
        }))
        build.onResolve({ filter: /^\.\// }, (args) => {
            if (args.path === "./GraphContainer.svelte")
                return { path: "container", namespace: "test" }
            if (Object.hasOwn(mocks, args.path)) return { path: args.path, namespace: "test" }
        })
        build.onLoad({ filter: /.*/, namespace: "test" }, (args) => {
            if (args.path === "entry") {
                return {
                    contents: `import { mount, unmount, flushSync } from "svelte";
                        import App from "${project}/src/ts/WorkloadForecast.svelte";
                        export const start = target => mount(App, { target });
                        export { unmount, flushSync };`,
                    loader: "js",
                    resolveDir: project,
                }
            }
            const contents =
                args.path === "container"
                    ? compile("<slot />", { filename: "GraphContainer.svelte", generate: "client" })
                          .js.code
                    : mocks[args.path]
            return { contents, loader: "js", resolveDir: project }
        })
    },
}

test("switching to reviews due redraws the graph above the review limit", async () => {
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
        SSEconfig: { barWidth: 600, barHeight: 250 },
    })
    const output = await esbuild.build({
        entryPoints: ["forecast-test-entry"],
        outfile: path.join(project, "forecast-test-bundle.js"),
        bundle: true,
        write: false,
        format: "cjs",
        platform: "browser",
        conditions: ["browser"],
        plugins: [mockPlugin, sveltePlugin({ preprocess: sveltePreprocess() })],
        logLevel: "silent",
    })
    const bundle = { exports: {} }
    new Function(
        "module",
        "exports",
        output.outputFiles.find((file) => file.path.endsWith(".js")).text
    )(bundle, bundle.exports)
    const app = bundle.exports.start(document.body)
    const flush = bundle.exports.flushSync
    flush()
    await Promise.resolve()
    flush()
    const [dayChoice, pathChoice] = document.querySelectorAll("select")
    expect(dayChoice.value).toBe("7")
    expect(pathChoice.value).toBe("3")
    expect(document.body.textContent).toContain("workload-forecast-three-help")
    document.querySelector("button").click()
    await Promise.resolve()
    await Promise.resolve()
    flush()
    expect(global.forecastRequest).toEqual({ search: "deck:current", days: 7, paths: 3 })
    expect(document.querySelectorAll(".workload-forecast-estimate-bound")).toHaveLength(2)
    dayChoice.value = "14"
    dayChoice.dispatchEvent(new window.Event("change", { bubbles: true }))
    pathChoice.value = "20"
    pathChoice.dispatchEvent(new window.Event("change", { bubbles: true }))
    flush()
    document.querySelector("button").click()
    await Promise.resolve()
    await Promise.resolve()
    flush()
    expect(global.forecastRequest).toEqual({ search: "deck:current", days: 14, paths: 20 })

    const maxAxisTick = () =>
        Math.max(
            ...Array.from(
                document.querySelectorAll(".workload-forecast-y-axis .tick text"),
                (node) => Number(node.textContent.replaceAll(",", ""))
            )
        )
    expect(maxAxisTick()).toBe(100)
    document.querySelector('input[value="due"]').click()
    flush()
    expect(maxAxisTick()).toBe(1800)
    document.querySelector('input[value="done"]').click()
    flush()
    expect(maxAxisTick()).toBe(100)
    pathChoice.value = "3"
    pathChoice.dispatchEvent(new window.Event("change", { bubbles: true }))
    flush()
    document.querySelector("button").click()
    await Promise.resolve()
    await Promise.resolve()
    flush()
    expect(global.forecastRequest.paths).toBe(3)
    expect(document.body.textContent).toContain("workload-forecast-fast-help")
    expect(document.querySelectorAll(".workload-forecast-estimate-bound")).toHaveLength(2)
    document.querySelector('input[value="due"]').click()
    flush()
    expect(maxAxisTick()).toBe(1800)

    const partial = {
        ...result,
        paths: 3,
        model: "instant",
        partial: true,
        scenario_kind: "stratified",
        scenario_history_days: 100,
        scenario_daily: [
            {
                day: 0,
                due: [1900, 1800, null],
                done: [100, 100, null],
                new: [0, 0, null],
                lapses: [20, 10, null],
                seconds: [1200, 1200, null],
            },
        ],
    }
    global.forecastStream = true
    global.forecastPollResult = {
        job_id: 1,
        phase: "running",
        unit: "days",
        current: 2,
        total: 3,
        partial_result: partial,
    }
    document.querySelector("button").click()
    await Promise.resolve()
    await Promise.resolve()
    flush()
    await new Promise((resolve) => setTimeout(resolve, 1100))
    flush()
    expect(document.body.textContent).toContain("workload-forecast-progress-days")
    expect(document.body.textContent).toContain("workload-forecast-partial")
    expect(document.body.textContent).toContain("workload-forecast-stratum-help")
    expect(document.body.textContent).toContain("workload-forecast-stratum-history")
    expect(document.querySelector(".workload-forecast-scenario-point-minus")).not.toBeNull()
    expect(document.querySelector(".workload-forecast-scenario-point-plus")).toBeNull()
    const complete = {
        ...partial,
        partial: false,
        scenario_daily: [
            {
                day: 0,
                due: [1900, 1800, 1700],
                done: [100, 100, 100],
                new: [0, 0, 0],
                lapses: [20, 10, 5],
                seconds: [1200, 1200, 1200],
            },
        ],
    }
    global.forecastPollResult = { job_id: 1, phase: "complete", result: complete }
    await new Promise((resolve) => setTimeout(resolve, 1100))
    flush()
    expect(document.body.textContent).not.toContain("workload-forecast-partial")
    expect(document.body.textContent).toContain("workload-forecast-stratum-totals")
    expect(document.querySelector(".workload-forecast-scenario-plus")).not.toBeNull()
    delete global.forecastStream
    delete global.forecastPollResult

    await bundle.exports.unmount(app)
    dom.window.close()
}, 30_000)
