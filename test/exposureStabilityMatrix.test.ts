import { FSRS7_DEFAULT_WEIGHTS } from "ts-fsrs/models/fsrs-7"
import type { CardData } from "../src/ts/cardData"
import type { ResolvedFsrsPreset } from "../src/ts/config"
import {
    buildExposureStabilityMatrix,
    DEFAULT_EXPOSURE_STABILITY_THRESHOLDS as defaults,
    exposureStabilityCellSearch,
    exposureStabilityThresholds,
    prepareExposureStabilityCards,
    validExposureStabilityThresholds,
} from "../src/ts/exposureStabilityMatrix"
import { getFsrsForParams } from "../src/ts/fsrsModel"

const preset = {
    params: [...FSRS7_DEFAULT_WEIGHTS],
    fsrsVersion: "seven",
    desiredRetention: 0.75,
} as ResolvedFsrsPreset
function card(id: number, data = { s: 12, s_int: 10, s_fast: 2, d: 8, dr: 0.9 }): CardData {
    return { id, reps: 5, type: 2, queue: 2, ivl: 500, data: JSON.stringify(data) } as CardData
}

const activeStudiedSearch = "-is:new -is:suspended -is:buried prop:reps>0 prop:s>0"

test.each<[number, number, string]>([
    [0, 0, "prop:reps<5 prop:s<7"],
    [0, 1, "prop:reps<5 prop:s>=7 prop:s<=30"],
    [0, 2, "prop:reps<5 prop:s>30"],
    [1, 0, "prop:reps>=5 prop:reps<=30 prop:s<7"],
    [1, 1, "prop:reps>=5 prop:reps<=30 prop:s>=7 prop:s<=30"],
    [1, 2, "prop:reps>=5 prop:reps<=30 prop:s>30"],
    [2, 0, "prop:reps>30 prop:s<7"],
    [2, 1, "prop:reps>30 prop:s>=7 prop:s<=30"],
    [2, 2, "prop:reps>30 prop:s>30"],
])(
    "cell (%i, %i) searches exposure rows and S90 columns with exact boundaries",
    (row, column, limits) => {
        expect(exposureStabilityCellSearch(row, column, defaults)).toBe(
            `${activeStudiedSearch} ${limits}`
        )
    }
)

test.each<[number, number, string]>([
    [0, 3, "prop:reps<5"],
    [1, 3, "prop:reps>=5 prop:reps<=30"],
    [2, 3, "prop:reps>30"],
    [3, 0, "prop:s<7"],
    [3, 1, "prop:s>=7 prop:s<=30"],
    [3, 2, "prop:s>30"],
    [3, 3, ""],
])("total (%i, %i) searches its full row, column or population", (row, column, limits) => {
    expect(exposureStabilityCellSearch(row, column, defaults)).toBe(
        [activeStudiedSearch, limits].filter(Boolean).join(" ")
    )
})

test("cell searches use applied rep thresholds and decimal S90 thresholds", () => {
    const thresholds = { repsLower: 10, repsUpper: 50, s90Lower: 0.25, s90Upper: 45.5 }
    expect(exposureStabilityCellSearch(0, 2, thresholds)).toBe(
        `${activeStudiedSearch} prop:reps<10 prop:s>45.5`
    )
    expect(exposureStabilityCellSearch(1, 1, thresholds)).toBe(
        `${activeStudiedSearch} prop:reps>=10 prop:reps<=50 prop:s>=0.25 prop:s<=45.5`
    )
})

test("all nine cells conserve cards and exact low/high boundaries stay in the middle", () => {
    const cards = [4, 5, 30, 31].flatMap((reps, r) =>
        [6, 7, 30, 31].map((s90, c) => ({ id: r * 4 + c, reps, s90, workload: 0.5 }))
    )
    const matrix = buildExposureStabilityMatrix(cards, defaults)
    expect(matrix.cells.map((row) => row.map((c) => c.count))).toEqual([
        [1, 2, 1],
        [2, 4, 2],
        [1, 2, 1],
    ])
    expect(matrix.count).toBe(16)
    expect(matrix.totalWorkload).toBe(8)
    expect(matrix.rowTotals).toEqual([
        { count: 4, workload: 2, workloadCards: 4 },
        { count: 8, workload: 4, workloadCards: 8 },
        { count: 4, workload: 2, workloadCards: 4 },
    ])
    expect(matrix.columnTotals).toEqual(matrix.rowTotals)
    expect(matrix.diagonal).toEqual({ count: 6, workload: 3, workloadCards: 6 })
    const shifted = buildExposureStabilityMatrix(cards, {
        repsLower: 10,
        repsUpper: 40,
        s90Lower: 10,
        s90Upper: 40,
    })
    expect(shifted.cells.map((row) => row.map((c) => c.count))).toEqual([
        [4, 4, 0],
        [4, 4, 0],
        [0, 0, 0],
    ])
})

test("invalid saved settings fall back and valid decimal S90 thresholds persist", () => {
    for (const value of [
        null,
        {},
        { ...defaults, repsLower: 5.5 },
        { ...defaults, repsUpper: 5 },
        { ...defaults, s90Lower: 0 },
        { ...defaults, s90Upper: NaN },
        { ...defaults, s90Upper: 7 },
    ]) {
        expect(validExposureStabilityThresholds(value)).toBe(false)
        expect(exposureStabilityThresholds(value)).toEqual(defaults)
    }
    expect(exposureStabilityThresholds({ ...defaults, s90Lower: 0.25 })).toEqual({
        ...defaults,
        s90Lower: 0.25,
    })
})

test("unstudied, inactive, missing-S90 and duplicate cards cannot inflate the active matrix", () => {
    const a = card(1)
    const source = [
        a,
        a,
        { ...card(2), type: 0 },
        { ...card(3), queue: -1 },
        { ...card(4), queue: -2 },
        { ...card(5), queue: -3 },
        { ...card(6), data: "{}" },
    ]
    const result = prepareExposureStabilityCards(source, {})
    expect(result.cards.map((c) => c.id)).toEqual([1])
    expect(result.excluded).toBe(5)
    expect(result.cards[0].workload).toBeNull()
})

test("workload uses both traces and difficulty at stored retention, independently of scheduled interval", () => {
    const a = card(1),
        b = { ...card(2), ivl: 1 },
        fast = card(3, { s: 12, s_int: 10, s_fast: 20, d: 8, dr: 0.9 }),
        easy = card(4, { s: 12, s_int: 10, s_fast: 2, d: 2, dr: 0.9 })
    const result = prepareExposureStabilityCards([a, b, fast, easy], {
        1: preset,
        2: preset,
        3: preset,
        4: preset,
    })
    const wa = result.cards[0].workload!
    expect(result.cards[1].workload).toBeCloseTo(wa, 12)
    expect(result.cards[2].workload).not.toBeCloseTo(wa, 5)
    expect(result.cards[3].workload).not.toBeCloseTo(wa, 5)
    const model = getFsrsForParams(preset.params)
    expect(
        model.retrievability({ stability: 10, stabilityFast: 2, difficulty: 8 }, 1 / wa)
    ).toBeCloseTo(0.9, 3)
    expect(result.cards[0].s90).toBe(12)
})

test("sub-day curve intervals cost at most one daily review, and missing full states remain countable", () => {
    const tiny = card(1, { s: 0.001, s_int: 0.001, s_fast: 0.001, d: 8, dr: 0.9 })
    const incomplete = { ...card(2), data: JSON.stringify({ s: 12, s_int: 10, d: 8, dr: 0.9 }) }
    const prepared = prepareExposureStabilityCards([tiny, incomplete], { 1: preset, 2: preset })
    expect(prepared.cards[0].workload).toBe(1)
    const m = buildExposureStabilityMatrix(prepared.cards, defaults)
    expect(m.count).toBe(2)
    expect(m.workloadCards).toBe(1)
    expect(m.totalWorkload).toBe(1)
    expect(m.diagonal).toEqual({ count: 1, workload: 0, workloadCards: 0 })
    expect(m.rowTotals[1]).toEqual({ count: 2, workload: 1, workloadCards: 1 })
    expect(m.columnTotals.reduce((sum, cell) => sum + cell.count, 0)).toBe(m.count)
})

test("a card without stored retention uses its resolved preset target", () => {
    const a = { ...card(1), data: JSON.stringify({ s: 12, s_int: 10, s_fast: 2, d: 8 }) }
    const b = card(2, { s: 12, s_int: 10, s_fast: 2, d: 8, dr: 0.75 })
    const r = prepareExposureStabilityCards([a, b], { 1: preset, 2: preset })
    expect(r.cards[0].workload).toBeCloseTo(r.cards[1].workload!, 12)
})
