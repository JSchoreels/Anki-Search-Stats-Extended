import _ from "lodash"
import { DeltaIfy } from "../src/ts/Candlestick"
import { calcTimePerReview } from "../src/ts/dayTimings"
import {
    averageDecay,
    buildForgettingCurve,
    computeStabilityForSeries,
    fitStability,
} from "../src/ts/forgettingCurveData"
import {
    calculateRevlogStats,
    calendarDayFromMs,
    day_ms,
    dayFromMs,
    easeBarChart,
} from "../src/ts/revlogGraphs"
import type { Revlog } from "../src/ts/search"
import { aggregateTimeBuckets, TimeBucketBuilder } from "../src/ts/timeBucketStats"
import { RevlogBuilder } from "./revlogBuilder"

const burden_revlog_builder1 = new RevlogBuilder()
const burden_revlog_builder2 = new RevlogBuilder()
const burden_revlogs: Revlog[] = [
    burden_revlog_builder1.review(-5000, 3),
    burden_revlog_builder1.review(-6000, 3),
    burden_revlog_builder1.review(1, 3),
    burden_revlog_builder1.review(2, 3),
    burden_revlog_builder1.review(0, 0),
    burden_revlog_builder1.wait(2 * day_ms),
    burden_revlog_builder1.review(-5000, 3),
    burden_revlog_builder1.review(-6000, 3),
    burden_revlog_builder1.review(1, 3),
    burden_revlog_builder1.review(4, 3),

    burden_revlog_builder2.wait(7 * day_ms),
    burden_revlog_builder2.review(1) as Revlog,
    burden_revlog_builder2.wait(2 * day_ms),
    burden_revlog_builder2.review(-5000) as Revlog,
].filter((a) => a) as Revlog[]

//Card1: 1, 0.5, 0.5, 0, 0, 1, 0.25, 0.25, 0.25, 0.25 0.25
//Card2: 0, 0,   0,   0, 0, 0, 0,    1,    1,    1    1(learning)
//Total: 1, 0.5, 0.5, 0, 0, 1, 0.25, 1.25, 1.25  1.25 1.25

// console.log(burden_revlogs.map(revlog=>({id: revlog.id / day_ms, ...revlog})))

const end = 10
const { burden, learn_steps_per_card } = calculateRevlogStats(
    burden_revlogs,
    [burden_revlog_builder1.card(), burden_revlog_builder2.card()] as any,
    end
)

const fsrs7Params = [
    0.041, 2.4175, 4.1283, 11.9709, 5.6385, 0.4468, 3.262, 2.3054, 0.1688, 1.3325, 0.3524, 0.0049,
    0.7503, 0.0896, 0.6625, 1.3, 0.882, 0.3072, 3.5875, 0.303, 0.0107, 0.2279, 2.6413, 0.5594, 1.3,
    2.5, 1.0, 0.0723, 0.1634, 0.5, 0.9555, 0.2245, 0.6232, 0.1362,
]
const fsrs7ParamsAlt = fsrs7Params.map((value, index) => {
    if (index === 27) {
        return 0.2
    }
    if (index === 28) {
        return 0.3
    }
    return value
})

test("Burden", () => {
    // expect(burden.length).toEqual(end + 1)
    expect(burden).toMatchObject([1, 0.5, 0.5, 0, 0, 1, 0.25, 1.25, 1.25, 1.25, 1.25])
})

test("Burden delta", () => {
    expect(DeltaIfy(burden)).toMatchObject([1, -0.5, 0, -0.5, 0, 1, -0.75, 1, 0, 0, 0])
})

test("learn_step_count", () => {
    console.log(burden_revlogs)
    expect(learn_steps_per_card).toContain(2)
})

test("Forgetting curve stability fit uses Anki minimum stability", () => {
    const stability = fitStability([{ cid: 1, firstRating: 1, delta: 10, recall: 0 }], 0.0001, -0.5)

    expect(stability).toBeGreaterThanOrEqual(0.0001)
    expect(stability).toBeLessThan(0.001)
})

test("Forgetting curve aggregates recall data", () => {
    const builder = new RevlogBuilder()
    const revlogs = [
        builder.review(0, 3),
        builder.review(1, 3),
        builder.wait(1 * day_ms),
        builder.review(1, 3),
        builder.wait(2 * day_ms),
        builder.review(1, 1),
    ].filter(Boolean) as Revlog[]

    const stats = calculateRevlogStats(
        revlogs,
        [{ ...builder.card(), data: '{"decay":0.35}' }] as any,
        builder.last_review + 5
    )
    const series_raw = buildForgettingCurve(stats.forgetting_samples)
    const series_with_stability = computeStabilityForSeries(
        series_raw,
        stats.forgetting_samples,
        stats.forgetting_curve_decay
    )
    const series = series_with_stability.find((entry) => entry.rating === 3)

    expect(series?.points.length).toBeGreaterThan(0)
    expect(series?.stability).not.toBeNull()
    expect(stats.forgetting_curve_decay).toBeCloseTo(averageDecay([0.35]), 6)
})

test("First long-term forgetting curve uses FSRS7 decay parameters", () => {
    const previousSSEother = global.SSEother
    try {
        global.SSEother = {
            ...previousSSEother,
            deck_configs: {
                1: {
                    id: 1,
                    fsrsParams7: fsrs7Params,
                    fsrsParams6: [],
                    fsrsParams5: [],
                    fsrsParams4: [],
                    fsrsWeights: [],
                },
            },
            deck_config_ids: {
                1: 1,
            },
            rollover: 0,
        }

        const builder = new RevlogBuilder()
        const revlogs = [
            builder.review(0, 3),
            builder.review(1, 3),
            builder.wait(2 * day_ms),
            builder.review(2, 3),
        ].filter(Boolean) as Revlog[]

        const stats = calculateRevlogStats(
            revlogs,
            [{ ...builder.card(), did: 1, data: "{}" }] as any,
            builder.last_review + 5
        )

        expect(Array.isArray(stats.forgetting_curve_long_term_model)).toBe(true)
        if (Array.isArray(stats.forgetting_curve_long_term_model)) {
            expect(stats.forgetting_curve_long_term_model.length).toBe(34)
            expect(stats.forgetting_curve_long_term_model[27]).toBeCloseTo(fsrs7Params[27], 6)
            expect(stats.forgetting_curve_long_term_model[28]).toBeCloseTo(fsrs7Params[28], 6)
        }

        const series_raw = buildForgettingCurve(stats.forgetting_samples)
        const series_with_stability = computeStabilityForSeries(
            series_raw,
            stats.forgetting_samples,
            stats.forgetting_curve_long_term_model
        )
        const series = series_with_stability.find((entry) => entry.rating === 3)
        expect(series?.stability).not.toBeNull()
    } finally {
        global.SSEother = previousSSEother
    }
})

test("First long-term forgetting curve uses each subdeck preset", () => {
    const previousSSEother = global.SSEother
    try {
        global.SSEother = {
            ...previousSSEother,
            deck_configs: {
                1: {
                    id: 1,
                    fsrsParams7: fsrs7Params,
                    fsrsParams6: [],
                    fsrsParams5: [],
                    fsrsParams4: [],
                    fsrsWeights: [],
                },
                2: {
                    id: 2,
                    fsrsParams7: fsrs7ParamsAlt,
                    fsrsParams6: [],
                    fsrsParams5: [],
                    fsrsParams4: [],
                    fsrsWeights: [],
                },
            },
            deck_config_ids: {
                1: 1,
                2: 2,
            },
            selected_deck_id: 1,
            rollover: 0,
        }

        const builder = new RevlogBuilder()
        const revlogs = [
            builder.review(0, 3),
            builder.review(1, 3),
            builder.wait(2 * day_ms),
            builder.review(2, 3),
        ].filter(Boolean) as Revlog[]

        const stats = calculateRevlogStats(
            revlogs,
            [{ ...builder.card(), did: 2, data: "{}" }] as any,
            builder.last_review + 5
        )

        expect(Array.isArray(stats.forgetting_curve_long_term_model)).toBe(true)
        if (Array.isArray(stats.forgetting_curve_long_term_model)) {
            expect(stats.forgetting_curve_long_term_model.length).toBe(34)
            expect(stats.forgetting_curve_long_term_model[27]).toBeCloseTo(fsrs7ParamsAlt[27], 6)
            expect(stats.forgetting_curve_long_term_model[28]).toBeCloseTo(fsrs7ParamsAlt[28], 6)
            expect(stats.forgetting_curve_long_term_model[27]).not.toBeCloseTo(fsrs7Params[27], 6)
        }
    } finally {
        global.SSEother = previousSSEother
    }
})

test("First short-term forgetting curve uses FSRS7 decay parameters", () => {
    const previousSSEother = global.SSEother
    try {
        global.SSEother = {
            ...previousSSEother,
            deck_configs: {
                1: {
                    id: 1,
                    fsrsParams7: fsrs7Params,
                    fsrsParams6: [],
                    fsrsParams5: [],
                    fsrsParams4: [],
                    fsrsWeights: [],
                },
            },
            deck_config_ids: {
                1: 1,
            },
            rollover: 0,
        }

        const builder = new RevlogBuilder()
        const revlogs = [
            builder.review(-5000, 3, 1000),
            builder.review(-6000, 2, 2000),
            builder.wait(2 * day_ms),
            builder.review(2, 3, 4000),
        ].filter(Boolean) as Revlog[]

        const stats = calculateRevlogStats(
            revlogs,
            [{ ...builder.card(), did: 1, data: "{}" }] as any,
            builder.last_review + 5
        )

        expect(Array.isArray(stats.forgetting_curve_long_term_model)).toBe(true)
        if (Array.isArray(stats.forgetting_curve_long_term_model)) {
            expect(stats.forgetting_curve_long_term_model.length).toBe(34)
            expect(stats.forgetting_curve_long_term_model[27]).toBeCloseTo(fsrs7Params[27], 6)
            expect(stats.forgetting_curve_long_term_model[28]).toBeCloseTo(fsrs7Params[28], 6)
        }

        const shortSeriesRaw = buildForgettingCurve(stats.forgetting_samples_short, {
            deltaLimitByRating: () => 720,
            disableOutlierFiltering: true,
        })
        const shortSeriesWithStability = computeStabilityForSeries(
            shortSeriesRaw,
            stats.forgetting_samples_short,
            stats.forgetting_curve_long_term_model,
            {
                minStability: 0.01,
                maxStability: 1440,
                daysPerUnit: 1 / 1440,
            }
        )
        const series = shortSeriesWithStability.find((entry) => entry.rating === 3)

        expect(stats.forgetting_samples_short.length).toBeGreaterThan(0)
        expect(series?.stability).not.toBeNull()
    } finally {
        global.SSEother = previousSSEother
    }
})

test("Time distribution by retrievability, stability and repetitions is generated", () => {
    const previousSSEother = global.SSEother
    try {
        global.SSEother = {
            ...previousSSEother,
            deck_configs: {
                1: {
                    id: 1,
                    fsrsParams7: fsrs7Params,
                    fsrsParams6: [],
                    fsrsParams5: [],
                    fsrsParams4: [],
                    fsrsWeights: [],
                },
            },
            deck_config_ids: {
                1: 1,
            },
            rollover: 0,
        }

        const builder = new RevlogBuilder()
        const revlogs = [
            builder.review(0, 3, 1000),
            builder.review(1, 3, 2000),
            builder.wait(2 * day_ms),
            builder.review(2, 3, 4000),
            builder.wait(2 * day_ms),
            builder.review(3, 2, 6000),
        ].filter(Boolean) as Revlog[]

        const stats = calculateRevlogStats(
            revlogs,
            [{ ...builder.card(), did: 1, data: "{}" }] as any,
            builder.last_review + 2
        )

        const retrievabilityValues = (stats.time_by_retrievability_mean ?? []).filter((v) =>
            Number.isFinite(v)
        )
        const stabilityValues = (stats.time_by_stability_mean ?? []).filter((v) =>
            Number.isFinite(v)
        )
        const repetitionValues = (stats.time_by_repetition_mean ?? []).filter((v) =>
            Number.isFinite(v)
        )
        const retrievabilityGradeCount = _.sum(
            (stats.grade_by_retrievability ?? []).flatMap((v) => v ?? [])
        )
        const retrievabilityGradeCountExcludeSameDay = _.sum(
            (stats.grade_by_retrievability_exclude_same_day ?? []).flatMap((v) => v ?? [])
        )
        const retrievabilityGradeCountSuccessOnly = _.sum(
            (stats.grade_by_retrievability_success_only ?? []).flatMap((v) => v ?? [])
        )
        const retrievabilityGradeCountSuccessOnlyExcludeSameDay = _.sum(
            (stats.grade_by_retrievability_success_only_exclude_same_day ?? []).flatMap(
                (v) => v ?? []
            )
        )
        const stabilityGradeCount = _.sum((stats.grade_by_stability ?? []).flatMap((v) => v ?? []))
        const stabilityGradeCountSuccessOnly = _.sum(
            (stats.grade_by_stability_success_only ?? []).flatMap((v) => v ?? [])
        )
        const repetitionGradeCount = _.sum(
            (stats.grade_by_repetitions ?? []).flatMap((v) => v ?? [])
        )
        const repetitionGradeCountSuccessOnly = _.sum(
            (stats.grade_by_repetitions_success_only ?? []).flatMap((v) => v ?? [])
        )
        const difficultyGradeCount = _.sum(
            (stats.grade_by_difficulty ?? []).flatMap((v) => v ?? [])
        )
        const difficultyGradeCountSuccessOnly = _.sum(
            (stats.grade_by_difficulty_success_only ?? []).flatMap((v) => v ?? [])
        )

        expect(retrievabilityValues.length).toBeGreaterThan(0)
        expect(stabilityValues.length).toBeGreaterThan(0)
        expect(repetitionValues.length).toBeGreaterThan(0)
        expect(Math.max(...retrievabilityValues)).toBeGreaterThan(0)
        expect(Math.max(...stabilityValues)).toBeGreaterThan(0)
        expect(Math.max(...repetitionValues)).toBeGreaterThan(0)
        expect(retrievabilityGradeCount).toBe(3)
        expect(retrievabilityGradeCountExcludeSameDay).toBe(2)
        expect(retrievabilityGradeCountSuccessOnly).toBe(3)
        expect(retrievabilityGradeCountSuccessOnlyExcludeSameDay).toBe(2)
        expect(stabilityGradeCount).toBe(3)
        expect(stabilityGradeCountSuccessOnly).toBe(3)
        expect(repetitionGradeCount).toBe(4)
        expect(repetitionGradeCountSuccessOnly).toBe(4)
        expect(difficultyGradeCount).toBe(3)
        expect(difficultyGradeCountSuccessOnly).toBe(3)

        expect(stats.time_by_repetition_mean[1]).toBeCloseTo(1)
        expect(stats.time_by_repetition_mean[2]).toBeCloseTo(2)
        expect(stats.time_by_repetition_mean[3]).toBeCloseTo(4)
        expect(stats.time_by_repetition_mean[4]).toBeCloseTo(6)
        expect(stats.grade_by_repetitions[1][2]).toBe(1)
        expect(stats.grade_by_repetitions[2][2]).toBe(1)
        expect(stats.grade_by_repetitions[3][2]).toBe(1)
        expect(stats.grade_by_repetitions[4][1]).toBe(1)
    } finally {
        global.SSEother = previousSSEother
    }
})

test("Active cards are split by young/mature and suspended", () => {
    const youngBuilder = new RevlogBuilder()
    const matureBuilder = new RevlogBuilder()
    const suspendedBuilder = new RevlogBuilder()

    const revlogs = [
        youngBuilder.review(10, 3),
        matureBuilder.review(30, 3),
        suspendedBuilder.review(30, 3),
    ].filter(Boolean) as Revlog[]

    const startDay = dayFromMs(revlogs[0].id)
    const endDay = startDay + 2

    const stats = calculateRevlogStats(
        revlogs,
        [
            { ...youngBuilder.card(), nid: 1, type: 2, queue: 2 },
            { ...matureBuilder.card(), nid: 2, type: 2, queue: 2 },
            { ...suspendedBuilder.card(), nid: 3, type: 2, queue: -1 },
        ] as any,
        endDay
    )

    for (const day of [startDay, startDay + 1, startDay + 2]) {
        expect(stats.active_cards_young_by_day[day] ?? 0).toBe(1)
        expect(stats.active_cards_mature_by_day[day] ?? 0).toBe(1)
        expect(stats.active_cards_all_by_day[day] ?? 0).toBe(2)

        expect(stats.suspended_active_cards_young_by_day[day] ?? 0).toBe(0)
        expect(stats.suspended_active_cards_mature_by_day[day] ?? 0).toBe(1)
        expect(stats.suspended_active_cards_all_by_day[day] ?? 0).toBe(1)
    }
})

test("Active card maturity uses stability when available", () => {
    const previousSSEother = global.SSEother
    try {
        global.SSEother = {
            ...previousSSEother,
            deck_configs: {
                1: {
                    id: 1,
                    fsrsParams6: [],
                    fsrsParams5: [],
                    fsrsParams4: [],
                    fsrsWeights: [],
                },
            },
            deck_config_ids: {
                1: 1,
            },
            rollover: 0,
        }

        const cid = 42
        const revlogs: Revlog[] = [
            {
                id: 1,
                cid,
                ease: 3,
                ivl: 1,
                lastIvl: 0,
                factor: 200,
                time: 1000,
                type: 1,
            },
            {
                id: 30 * day_ms + 1,
                cid,
                ease: 3,
                ivl: 5,
                lastIvl: 1,
                factor: 200,
                time: 1000,
                type: 1,
            },
        ]

        const endDay = dayFromMs(revlogs[1].id)
        const stats = calculateRevlogStats(
            revlogs,
            [
                {
                    id: cid,
                    nid: 1,
                    did: 1,
                    ord: 0,
                    mod: 0,
                    usn: 0,
                    type: 2,
                    queue: 2,
                    due: 0,
                    ivl: 5,
                    factor: 0,
                    reps: 0,
                    lapses: 0,
                    left: 0,
                    odue: 0,
                    odid: 0,
                    flags: 0,
                    data: "{}",
                },
            ],
            endDay
        )

        expect(stats.active_cards_mature_by_day[endDay] ?? 0).toBe(1)
        expect(stats.active_cards_young_by_day[endDay] ?? 0).toBe(0)
    } finally {
        global.SSEother = previousSSEother
    }
})

test("rated zero-time reviews count consistently and manual entries do not count as ratings", () => {
    const builder = new RevlogBuilder()
    const revlogs = [
        builder.review(1, 3, 0),
        builder.review(2, 1, 1000),
        builder.review(2, 0, 1000),
    ] as Revlog[]
    const day = dayFromMs(revlogs[0].id)
    const stats = calculateRevlogStats(revlogs, [builder.card()] as any, builder.last_review)
    const sumRatings = (values: number[][]) => values.reduce((sum, row) => sum + _.sum(row), 0)

    expect(sumRatings(stats.day_ease.all)).toBe(2)
    expect(sumRatings(stats.day_ease.learn) + sumRatings(stats.day_ease.not_learn)).toBe(2)
    expect(sumRatings(stats.fatigue_ease.all)).toBe(2)
    expect(stats.fatigue_ease.all[0]).toEqual([1, 0, 1, 0])
    expect(sumRatings(stats.interval_ease)).toBe(2)
    expect(sumRatings(stats.time_ease_seconds.all)).toBe(2)
    expect(stats.day_ease.all[day]).toEqual([0, 0, 1, 0])
    expect(sumRatings(stats.day_filtered_review_hours)).toBe(2)
    expect(sumRatings(stats.day_review_hours)).toBe(2)
})

test("empty normalized rating buckets have finite zero values", () => {
    const bins: number[][] = []
    bins[2] = [0, 0, 0, 0]
    bins[3] = [1, 1, 2, 0]
    const graph = easeBarChart(bins, 0, true)
    expect(graph.data[0].values).toEqual([0, 0, 0, 0])
    expect(graph.data[2].values).toEqual([0, 0, 0, 0])
    expect(graph.data[3].values).toEqual([0, 0.5, 0.25, 0.25])
})

test("wide time buckets compute statistics from every review, including uneven populations", () => {
    const builder = new TimeBucketBuilder(1)
    const original = [Array(100).fill(10), [100], [], [20, 30]]
    original.forEach((values, bucket) =>
        values.forEach((seconds) => builder.add(seconds, [bucket]))
    )
    const [samples] = builder.finish()
    expect(aggregateTimeBuckets(samples, 0, 2, "mean")).toEqual([1100 / 101])
    expect(aggregateTimeBuckets(samples, 0, 2, "median")).toEqual([10])
    expect(aggregateTimeBuckets(samples, 2, 2, "mean")).toEqual([25])
    expect(aggregateTimeBuckets(samples, 2, 2, "median")).toEqual([25])
    expect(aggregateTimeBuckets(samples, 2, 1, "mean")).toEqual([0])
    expect(aggregateTimeBuckets(samples, 8, 2, "median")).toEqual([0])
    expect(aggregateTimeBuckets(samples, -3, 2, "mean")).toEqual([0])
    expect(aggregateTimeBuckets(samples, -1, 2, "mean")).toEqual([10])
    expect(samples.values[samples.indices[samples.offsets[1]]]).toBe(100)
})

test("review speed skips days without reviews instead of dividing by zero", () => {
    const reviews = (learn: number) => ({ learn, mature: 0, young: 0, relearn: 0, filtered: 0 })
    const values = calcTimePerReview({
        count: { "0": reviews(0), "-1": reviews(2) },
        time: { "0": reviews(0), "-1": reviews(6000) },
    } as any)
    expect(values.filter((value) => value !== undefined)).toEqual([3])
})

test("hourly review counts use the local calendar date and local hour together", () => {
    const beforeMidnight = new Date(2026, 9, 3, 23, 59).getTime()
    const afterMidnight = new Date(2026, 9, 4, 0, 1).getTime()
    const revlogs = [beforeMidnight, afterMidnight].map((id) => ({
        id,
        cid: 1,
        ease: 3,
        ivl: 1,
        lastIvl: 1,
        factor: 200,
        time: 0,
        type: 1,
    })) as Revlog[]
    const stats = calculateRevlogStats(
        revlogs,
        [{ id: 1, ivl: 1 }] as any,
        dayFromMs(afterMidnight)
    )
    expect(calendarDayFromMs(beforeMidnight)).toBe(Date.UTC(2026, 9, 3) / day_ms)
    expect(calendarDayFromMs(afterMidnight)).toBe(Date.UTC(2026, 9, 4) / day_ms)
    expect(stats.day_review_hours[calendarDayFromMs(beforeMidnight)][23]).toBe(1)
    expect(stats.day_review_hours[calendarDayFromMs(afterMidnight)][0]).toBe(1)
})
