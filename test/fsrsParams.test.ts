import { default_w } from "ts-fsrs"
import { selectTsFsrsParams } from "../src/ts/fsrsParams"

function deckConfigWithParams(params: Partial<Record<string, number[]>>) {
    return {
        id: 1,
        fsrsParams7: [],
        fsrsParams6: [],
        fsrsParams5: [],
        fsrsParams4: [],
        fsrsWeights: [],
        ...params,
    } as any
}

test("selects fsrsParams7 when ts-fsrs compatible", () => {
    const params7 = Array.from({ length: 35 }, (_, i) => i + 1)
    const selected = selectTsFsrsParams(
        deckConfigWithParams({
            fsrsParams7: params7,
            fsrsParams6: Array.from({ length: 21 }, (_, i) => 100 + i),
        })
    )

    expect(selected).toStrictEqual(params7)
})

test("falls back to fsrsParams6 when fsrsParams7 contains non-finite values", () => {
    const params6 = Array.from({ length: 21 }, (_, i) => 10 + i)
    const params7 = Array.from({ length: 35 }, (_, i) => 100 + i)
    params7[0] = Number.NaN
    const selected = selectTsFsrsParams(
        deckConfigWithParams({
            fsrsParams7: params7,
            fsrsParams6: params6,
        })
    )

    expect(selected).toStrictEqual(params6)
})

test("falls back to default params when no compatible params are present", () => {
    const selected = selectTsFsrsParams(
        deckConfigWithParams({
            fsrsParams7: Array.from({ length: 34 }, (_, i) => i + 1),
            fsrsParams6: [1, 2, 3],
            fsrsParams5: [4, 5, 6],
            fsrsParams4: [7, 8, 9],
            fsrsWeights: [],
        })
    )

    expect(selected).toStrictEqual([...default_w])
})
