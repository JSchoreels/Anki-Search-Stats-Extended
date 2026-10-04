// node --expose-gc benchmark/fsrs.mjs BASELINE_DIR NATIVE_ORACLE API_JSON OUTPUT_JSON
// Each side imports its actual source. Native reference requests use no collection data.
import esbuild from "esbuild"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
const [baseline, oracle, apiPath, output] = process.argv.slice(2)
const nativeApi = JSON.parse(fs.readFileSync(apiPath, "utf8"))
const now = new Date(2026, 9, 4, 15, 23).getTime()
Date.now = () => now
const weights7 = require("ts-fsrs/models/fsrs-7").FSRS7_DEFAULT_WEIGHTS
const weights6 = require("ts-fsrs/models/fsrs-6").FSRS6_DEFAULT_WEIGHTS
const wAlt = [...weights7]
wAlt[23] = 0.5
wAlt[27] = 0.8
wAlt[29] = 0.4
const config = { id: 1, fsrsVersion: 0, fsrsParams7: [...weights7], sm2Retention: 0.9 }
globalThis.SSEconfig = {}
globalThis.SSEother = {
    lang: "en",
    lang_ftl: "",
    fallback_ftl: "",
    rollover: 4,
    days_elapsed: nativeApi.collectionToday,
    deck_configs: { 1: config },
    deck_config_ids: { 1: 1 },
}
const originalConsole = globalThis.console
globalThis.console = { ...originalConsole, log() {}, warn() {}, time() {}, timeEnd() {} }
async function bundle(source, name) {
    const files = [
        "srHeatmap",
        "MemorisedBar",
        "revlogGraphs",
        "forgettingCurveData",
        "fsrsModel",
        "ankiDay",
        "fsrsHistory",
    ].filter((file) => fs.existsSync(path.join(source, "src/ts", `${file}.ts`)))
    const target = `/tmp/sse-${name}-bench.cjs`
    await esbuild.build({
        stdin: {
            contents: files
                .map(
                    (file) =>
                        `export * from ${JSON.stringify(path.join(source, "src/ts", `${file}.ts`))}`
                )
                .join("\n"),
            resolveDir: root,
            loader: "ts",
        },
        outfile: target,
        bundle: true,
        platform: "node",
        format: "cjs",
        logLevel: "silent",
        nodePaths: [path.join(root, "node_modules")],
        plugins: [
            {
                name: "pure-inputs",
                setup(build) {
                    build.onResolve({ filter: /^\.\/search$/ }, (args) => ({
                        path: path.join(path.dirname(args.importer), "cardData.ts"),
                    }))
                    build.onResolve({ filter: /anki\/ts\/lib\/tslib\/cards$/ }, () => ({
                        path: path.join(root, "anki/ts/lib/tslib/cards.ts"),
                    }))
                },
            },
        ],
    })
    return require(target)
}
const old = await bundle(path.resolve(baseline), "old")
const current = await bundle(root, "new")
function native(cases) {
    return JSON.parse(
        execFileSync(oracle, [], {
            input: JSON.stringify(cases),
            maxBuffer: 32 * 1024 * 1024,
        }).toString()
    )
}
function summary(errors) {
    return {
        mean: errors.reduce((a, b) => a + b, 0) / errors.length,
        max: Math.max(...errors),
        count: errors.length,
    }
}
async function measurePair(oldFn, newFn) {
    const functions = { old: oldFn, new: newFn }
    for (const fn of Object.values(functions)) await fn()
    const timings = { old: [], new: [] }
    // Alternate execution order to reduce drift from runtime warm-up or system load.
    for (let run = 0; run < 7; run++) {
        for (const side of run % 2 === 0 ? ["old", "new"] : ["new", "old"]) {
            delete globalThis.__sseBenchmarkResult
            global.gc()
            const start = performance.now()
            const result = await functions[side]()
            timings[side].push(performance.now() - start)
            if (!result) throw new Error("missing benchmark result")
            globalThis.__sseBenchmarkResult = result
        }
    }
    return Object.entries(timings).map(([side, runs]) => ({
        side,
        medianMs: [...runs].sort((a, b) => a - b)[3],
        maxMs: Math.max(...runs),
        runs,
    }))
}
const report = {
    environment: {
        node: process.version,
        platform: os.platform(),
        arch: os.arch(),
        cpu: os.cpus()[0].model,
        timezone: process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        baseline: path.resolve(baseline),
        nativeRevision: "4bc0a0979f95dd01cc653031b6f2a01429e4c32b",
        timestamp: new Date(now).toISOString(),
    },
    precision: {},
    performance: [],
}

// Current heatmap: authoritative native API values, including manually shifted due dates.
for (const [name, side] of [
    ["old", old],
    ["new", current],
]) {
    const values =
        side.create_card_sr_dataset(
            nativeApi.cards,
            name === "old" ? nativeApi.collectionToday : nativeApi.retrievability
        )?.card_sr_data ?? []
    const expected = nativeApi.cards.map((card) => nativeApi.retrievability[card.id])
    // Keep native id alignment even when the old path excludes invalid estimates.
    const errors = []
    for (const card of nativeApi.cards) {
        const row = side.create_card_sr_dataset(
            [card],
            name === "old" ? nativeApi.collectionToday : nativeApi.retrievability
        )?.card_sr_data[0]
        if (row) errors.push(Math.abs(row.r - nativeApi.retrievability[card.id]) * 100)
    }
    report.precision[`heatmap_${name}`] = {
        probabilityErrorPp: summary(errors),
        plotted: values.length,
        eligible: expected.length,
    }
}

// Native bridge and subsequent replay: 17/19/21/34 weights, multiple intervals/retentions.
const cases = []
for (const weights of [
    [...weights6].slice(0, 17),
    [...weights6].slice(0, 19),
    [...weights6],
    [...weights7],
])
    for (const interval of [1, 30, 300])
        for (const [factor, retention] of [
            [2500, 0.9],
            [0, 0.85],
            [800, 0.95],
        ]) {
            cases.push({
                weights,
                interval,
                factor,
                retention,
                reviews: [
                    { delta: 1, rating: 3 },
                    { delta: 7, rating: 1 },
                    { delta: 2, rating: 4 },
                ],
                elapsed: 3.25,
            })
        }
const references = native(cases)
fs.writeFileSync(
    path.join(root, "test/fixtures/fsrs-native-reference.json"),
    JSON.stringify(
        {
            revision: report.environment.nativeRevision,
            cases: cases.map((input, i) => ({ input, expected: references[i] })),
        },
        null,
        2
    ) + "\n"
)
for (const [name, side] of [
    ["old", old],
    ["new", current],
]) {
    const errors = []
    for (let i = 0; i < cases.length; i++) {
        const input = cases[i],
            model = side.getFsrsForParams(input.weights)
        const review = { ivl: input.interval, factor: input.factor, ease: 3 }
        let state =
            name === "new"
                ? side.stateFromIncompleteHistory(model, review, input.retention)
                : model.nextState(null, 0, 3)
        for (const review of input.reviews)
            state = model.nextState(state, review.delta, review.rating)
        errors.push(
            Math.abs(
                model.retrievability(
                    state,
                    input.weights.length === 34 ? input.elapsed : Math.round(input.elapsed)
                ) - references[i].r
            ) * 100
        )
    }
    report.precision[`incomplete_${name}`] = { probabilityErrorPp: summary(errors) }
}

// Daily values use the native curve at the real local end-of-day boundary.
const dailyCases = []
for (const date of [
    new Date(2026, 2, 28, 23, 55),
    new Date(2026, 2, 29, 3, 50),
    new Date(2026, 9, 4, 14, 20),
]) {
    const review = {
        id: date.getTime(),
        cid: 1,
        ease: 3,
        time: 1000,
        type: 0,
        factor: 200,
        ivl: 1,
        lastIvl: 0,
    }
    const state = current.getFsrsForParams(weights7).nextState(null, 0, 3)
    const day = current.dayFromMs(review.id)
    const elapsed = (current.ankiDaySnapshotMs(day, 4, now) - review.id) / 86400000
    dailyCases.push({
        review,
        day,
        elapsed,
        input: {
            weights: [...weights7],
            reviews: [],
            state: [state.stability, state.stabilityFast, state.difficulty],
            elapsed,
        },
    })
}
const dailyReference = native(dailyCases.map((c) => c.input))
for (const [name, side] of [
    ["old", old],
    ["new", current],
]) {
    const errors = []
    for (let i = 0; i < dailyCases.length; i++) {
        const c = dailyCases[i]
        const stats = await side.getMemorisedDays(
            [c.review],
            [{ id: 1, nid: 1, did: 1, reps: 1, data: "{}" }],
            { 1: config },
            { 1: 1 }
        )
        errors.push(Math.abs(stats.retrievabilityDays[c.day] - dailyReference[i].r) * 100)
    }
    report.precision[`daily_${name}`] = { probabilityErrorPp: summary(errors) }
}

// Mixed-preset curve: each preset has its own first-review state. Assess a fixed 50/50
// cohort, without confounding by fit noise, before timing the complete fitting pipeline.
const mixedNative = []
const deltaValues = [0.1, 1, 3, 7, 30, 90]
for (const weights of [weights7, wAlt])
    for (const delta of deltaValues) {
        const state = current.getFsrsForParams(weights).nextState(null, 0, 3)
        mixedNative.push({
            weights: [...weights],
            state: [state.stability, state.stabilityFast, state.difficulty],
            reviews: [],
            elapsed: delta,
        })
    }
const mixRef = native(mixedNative)
const initial = current.getFsrsForParams(weights7).nextState(null, 0, 3).stability
const mixture = { models: [[...weights7], wAlt], cards: { 1: 0, 2: 1 } }
const entry = {
    rating: 3,
    stability: initial,
    fits: [
        { model: [...weights7], stability: initial, count: 1 },
        { model: wAlt, stability: initial, count: 1 },
    ],
}
const predict = current.createSeriesPredictor(entry, mixture)
const averaged = weights7.map((w, i) => (w + wAlt[i]) / 2)
for (const [name, fn] of [
    ["old", (delta) => old.forgettingCurveWithModel(averaged, delta, initial, 3)],
    ["new", predict],
]) {
    const errors = deltaValues.map(
        (delta, i) =>
            Math.abs(fn(delta) - (mixRef[i].r + mixRef[deltaValues.length + i].r) / 2) * 100
    )
    report.precision[`mixed_curve_${name}`] = { probabilityErrorPp: summary(errors) }
}

for (const size of [1000, 10000]) {
    const cards = nativeApi.cards.slice(0, size)
    for (const row of await measurePair(
        () => old.create_card_sr_dataset(cards, nativeApi.collectionToday),
        () => current.create_card_sr_dataset(cards, nativeApi.retrievability)
    ))
        report.performance.push({ task: "heatmap", size, ...row })
    const samples = Array.from({ length: size }, (_, i) => ({
        cid: (Math.floor(i / 4) % 2) + 1,
        firstRating: (i % 4) + 1,
        delta: (i % 90) + 1,
        recall: (i * 37) % 100 < 80 ? 1 : 0,
    }))
    for (const row of await measurePair(
        () =>
            old.computeStabilityForSeries(
                old.buildForgettingCurve(samples, { disableOutlierFiltering: true }),
                samples,
                averaged
            ),
        () =>
            current.computeStabilityForSeries(
                current.buildForgettingCurve(samples, { disableOutlierFiltering: true }),
                samples,
                mixture
            )
    ))
        report.performance.push({ task: "curve fitting", size, ...row })
    const replayCards = Array.from({ length: size }, (_, i) => ({
        id: i + 1,
        nid: i + 1,
        did: 1,
        reps: 12,
        data: "{}",
    }))
    const history = []
    const start = new Date(2026, 3, 7, 12).getTime()
    for (const card of replayCards)
        for (let j = 0; j < 12; j++)
            history.push({
                id: start + j * 15 * 86400000 + card.id * 13,
                cid: card.id,
                ease: j % 5 === 4 ? 1 : 3,
                time: 1000,
                type: j === 0 ? 0 : 1,
                factor: 200,
                ivl: 15,
                lastIvl: j === 0 ? 0 : 15,
            })
    history.sort((a, b) => a.id - b.id)
    for (const row of await measurePair(
        () => old.getMemorisedDays(history, replayCards, { 1: config }, { 1: 1 }),
        () => current.getMemorisedDays(history, replayCards, { 1: config }, { 1: 1 })
    ))
        report.performance.push({ task: "180-day Memorised (12 reviews/card)", size, ...row })
    const truncated = history.filter((r) => r.type !== 0)
    for (const row of await measurePair(
        () => old.getMemorisedDays(truncated, replayCards, { 1: config }, { 1: 1 }),
        () => current.getMemorisedDays(truncated, replayCards, { 1: config }, { 1: 1 })
    ))
        report.performance.push({
            task: "165-day Memorised (missing learning history)",
            size,
            ...row,
        })
}
report.nativeApi = nativeApi.rows
fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n")
globalThis.console = originalConsole
console.log(
    JSON.stringify(
        {
            precision: report.precision,
            performance: report.performance.map(({ runs, ...row }) => row),
            nativeApi: report.nativeApi,
        },
        null,
        2
    )
)
