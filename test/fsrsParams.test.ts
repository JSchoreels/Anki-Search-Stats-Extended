import { default_w } from "ts-fsrs"
import { selectResolvedFsrsPresetParams, selectTsFsrsParams } from "../src/ts/fsrsParams"

function deckConfigWithParams(params: Record<string, any>) {
    return {
        id: 1,
        fsrsVersion: 0,
        fsrsParams7: [],
        fsrsParams6: [],
        fsrsParams5: [],
        fsrsParams4: [],
        fsrsWeights: [],
        ...params,
    } as any
}

test("selects final fsrsParams7 when ts-fsrs compatible", () => {
    const params7 = Array.from({ length: 34 }, (_, i) => i + 1)
    const selected = selectTsFsrsParams(
        deckConfigWithParams({
            fsrsParams7: params7,
            fsrsParams6: Array.from({ length: 21 }, (_, i) => 100 + i),
        })
    )

    expect(selected).toStrictEqual(params7)
})

test("falls back to compatible FSRS-6 params for an unsupported FSRS-7 layout", () => {
    const params7 = Array.from({ length: 35 }, (_, i) => i + 1)
    const params6 = Array.from({ length: 21 }, (_, i) => 100 + i)
    const selected = selectTsFsrsParams(
        deckConfigWithParams({
            fsrsParams7: params7,
            fsrsParams6: params6,
        })
    )

    expect(selected).toStrictEqual(params6)
})

test("falls back to fsrsParams6 when fsrsParams7 contains non-finite values", () => {
    const params6 = Array.from({ length: 21 }, (_, i) => 10 + i)
    const params7 = Array.from({ length: 34 }, (_, i) => 100 + i)
    params7[0] = Number.NaN
    const selected = selectTsFsrsParams(
        deckConfigWithParams({
            fsrsParams7: params7,
            fsrsParams6: params6,
        })
    )

    expect(selected).toStrictEqual(params6)
})

test("respects selected FSRS version when selected params are usable", () => {
    const params6 = Array.from({ length: 21 }, (_, i) => 10 + i)
    const params7 = Array.from({ length: 34 }, (_, i) => 100 + i)
    const selected = selectTsFsrsParams(
        deckConfigWithParams({
            fsrsVersion: 1,
            fsrsParams7: params7,
            fsrsParams6: params6,
        })
    )

    expect(selected).toStrictEqual(params6)
})

test("falls back when selected FSRS version params are unusable", () => {
    const params7 = Array.from({ length: 34 }, (_, i) => 100 + i)
    const selected = selectTsFsrsParams(
        deckConfigWithParams({
            fsrsVersion: 1,
            fsrsParams7: params7,
            fsrsParams6: [1, 2, 3],
        })
    )

    expect(selected).toStrictEqual(params7)
})

test("falls back to default params when no compatible params are present", () => {
    const selected = selectTsFsrsParams(
        deckConfigWithParams({
            fsrsParams7: Array.from({ length: 36 }, (_, i) => i + 1),
            fsrsParams6: [1, 2, 3],
            fsrsParams5: [4, 5, 6],
            fsrsParams4: [7, 8, 9],
            fsrsWeights: [],
        })
    )

    expect(selected).toStrictEqual([...default_w])
})

test("selects Anki-resolved preset params directly", () => {
    const params7 = Array.from({ length: 34 }, (_, i) => i + 1)
    const selected = selectResolvedFsrsPresetParams({
        id: "addon:test",
        name: "Test",
        fsrsVersion: "seven",
        params: params7,
        desiredRetention: 0.9,
        historicalRetention: 0.9,
        ignoreRevlogsBeforeDate: "",
        fsrsDynamicDesiredRetentionEnabled: true,
        fsrsDynamicDesiredRetentionParams: Array.from({ length: 15 }, () => 0),
        fsrsDynamicDesiredRetentionWeights: [0, 15],
        fsrsDynamicDesiredRetentionAvgDrs: [0.9, 0.8],
        fsrsDynamicDesiredRetentionFsrsEqWeights: [0, 15],
        fsrsDynamicDesiredRetentionFsrsEqDrs: [0.92, 0.78],
        fsrsDynamicDesiredRetentionMin: 0.75,
        fsrsDynamicDesiredRetentionMax: 0.95,
    })

    expect(selected).toStrictEqual(params7)
})
