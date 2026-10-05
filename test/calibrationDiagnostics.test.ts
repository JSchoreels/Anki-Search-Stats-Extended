import { calibrationDiagnosticReport } from "../src/ts/calibrationDiagnostics"
import type { CalibrationSample } from "../src/ts/MemorisedBar"

const samples: CalibrationSample[] = [1, 2, 3].map((day) => ({
    revlogId: Date.UTC(2026, 9, day),
    cid: day,
    actual: 1,
}))
const ids = samples.map((sample) => sample.revlogId)
const replay = { [ids[0]]: 0.8, [ids[1]]: 0.9, [ids[2]]: 0.95 }
const cached = { [ids[2]]: 0.95 }
const fsrs = {
    column: "search_stats_fsrs_review_retrievability",
    cachedPredictionCount: 1,
    roles: ["post_optimization"],
    predictionsByRevlogId: cached,
}
const rwkv = { column: "rwkv-cache", predictionsByRevlogId: replay }

test("recent RWKV coverage reports saved and replayed counts separately", () => {
    const report = calibrationDiagnosticReport(
        samples,
        replay,
        fsrs,
        {
            ...rwkv,
            roles: ["post_optimization", "post_optimization_replay"],
            roleCounts: { post_optimization: 1, post_optimization_replay: 2 },
        },
        0
    )
    expect(report).toContain("build 2026-10-05.7")
    expect(report).toContain(
        "cached post-optimization reviews: 1; post-optimization replay reviews: 2"
    )
    expect(report).toContain("2026-10-01T00:00:00.000Z to 2026-10-03T00:00:00.000Z")
    expect(report).toContain("these are not historical validation folds")
})

test("sparse cache report distinguishes full replay, selected samples and hidden UM+ pairs", () => {
    const report = calibrationDiagnosticReport(samples, replay, fsrs, rwkv, 0)
    expect(report).toContain("Eligible historical calibration samples: 3")
    expect(report).toContain("FSRS historical replay predictions: 3")
    expect(report).toContain("FSRS cached predictions returned: 1")
    expect(report).toContain("FSRS graph uses: cached predictions only")
    expect(report).toContain("FSRS reviews used: 1; eligible without selected FSRS prediction: 2")
    expect(report).toContain("2026-10-03T00:00:00.000Z to 2026-10-03T00:00:00.000Z")
    expect(report).toContain("Paired FSRS + RWKV reviews: 1")
    expect(report).toContain(
        "UM+ populated buckets: 1; buckets visible with default >=200 filter: 0"
    )
    expect(report).toContain("Cache selection reduces the FSRS sample")
    expect(report).toContain(
        "no historical validation_fold predictions were returned for this search"
    )
    expect(report).not.toContain(String(ids[2]))
})

test("empty cache fallback and missing role metadata are distinguished from validation absence", () => {
    const report = calibrationDiagnosticReport(
        samples,
        replay,
        {
            column: null,
            cachedPredictionCount: 0,
            roles: [],
            predictionsByRevlogId: replay,
        },
        { column: null, predictionsByRevlogId: {} },
        0
    )
    expect(report).toContain("historical replay fallback")
    expect(report).toContain("none / not reported")
    expect(report).toContain("Paired FSRS + RWKV reviews: 0")
    expect(report).not.toContain("no historical validation_fold predictions")
    expect(report).not.toContain("UM+ pairs exist")
})
