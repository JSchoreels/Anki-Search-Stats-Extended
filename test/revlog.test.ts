import { DeltaIfy } from "../src/ts/Candlestick"
import { calculateRevlogStats, day_ms, dayFromMs } from "../src/ts/revlogGraphs"
import type { Revlog } from "../src/ts/search"
import { RevlogBuilder } from "./revlogBuilder"
import { averageDecay, buildForgettingCurve, computeStabilityForSeries } from "../src/ts/forgettingCurveData"

const burden_revlog_builder1 = new RevlogBuilder()
const burden_revlog_builder2 = new RevlogBuilder()
const burden_revlogs : Revlog[] = [
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

    burden_revlog_builder2.wait(7*day_ms),
    burden_revlog_builder2.review(1) as Revlog,
    burden_revlog_builder2.wait(2*day_ms),
    burden_revlog_builder2.review(-5000) as Revlog, 
].filter(a=>a) as Revlog[]

//Card1: 1, 0.5, 0.5, 0, 0, 1, 0.25, 0.25, 0.25, 0.25 0.25
//Card2: 0, 0,   0,   0, 0, 0, 0,    1,    1,    1    1(learning)
//Total: 1, 0.5, 0.5, 0, 0, 1, 0.25, 1.25, 1.25  1.25 1.25

// console.log(burden_revlogs.map(revlog=>({id: revlog.id / day_ms, ...revlog})))

const end = 10
const {burden, learn_steps_per_card} = calculateRevlogStats(burden_revlogs, [burden_revlog_builder1.card(), burden_revlog_builder2.card()] as any, end)

test("Burden", () =>{
    // expect(burden.length).toEqual(end + 1)
    expect(burden).toMatchObject([1, 0.5, 0.5, 0, 0, 1, 0.25, 1.25, 1.25, 1.25, 1.25])
})

test("Burden delta", () =>{
    expect(DeltaIfy(burden)).toMatchObject([1, -0.5, 0, -0.5, 0, 1, -0.75, 1, 0, 0, 0])
})

test("learn_step_count", ()=>{
    console.log(burden_revlogs)
    expect(learn_steps_per_card).toContain(2)
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
