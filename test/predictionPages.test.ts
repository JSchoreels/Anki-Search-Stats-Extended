import {
    parseReviewRetrievabilityPages,
    parseReviewRetrievabilityResponse,
} from "../src/ts/calibrationPredictions"
import { calibrationSamplesFrom, EMPTY_CALIBRATION_SAMPLES } from "../src/ts/calibrationSamples"

function stream(text: string, chunkSize = 13) {
    const bytes = new TextEncoder().encode(text)
    let offset = 0
    return new ReadableStream<Uint8Array>({
        pull(controller) {
            if (offset === bytes.length) controller.close()
            else {
                controller.enqueue(bytes.slice(offset, offset + chunkSize))
                offset = Math.min(bytes.length, offset + chunkSize)
            }
        },
    })
}
function pages(metadata: object, rows: unknown[][], pageSize = 2) {
    const lines = [
        JSON.stringify({ ...metadata, format: "prediction-pages-v1", row_count: rows.length }),
    ]
    for (let start = 0; start < rows.length; start += pageSize)
        lines.push(JSON.stringify({ data: rows.slice(start, start + pageSize) }))
    lines.push('{"done":true}')
    return lines.join("\n")
}

test("paged predictions match full JSON across duplicate and UTF-8 chunk boundaries", async () => {
    const samples = calibrationSamplesFrom(
        [12, 10, 11, 12, 20].map((revlogId) => ({ revlogId, cardId: 1, actual: 1 }))
    )
    const data = [
        [10, 0],
        [12, "0.2"],
        [12, "0.8"],
        [12, null],
        [20, "invalid"],
        [99, 1.2],
        [100, -0.1],
    ]
    const metadata = {
        column: "cache",
        roles: ["test_fold", null],
        role_counts: { test_fold: 2, negative: -1 },
        warnings: ["日本語 warning", "", null],
        refresh_after_fsrs: true,
    }
    const expected = parseReviewRetrievabilityResponse(
        JSON.stringify({ ...metadata, data }),
        samples
    )
    expect(await parseReviewRetrievabilityPages(stream(pages(metadata, data), 1), samples)).toEqual(
        expected
    )
    expect(expected.predictions).toEqual(new Float64Array([0.8, 0, NaN, 0.8, NaN]))
    expect(expected.responsePredictionCount).toBe(4)
})

test.each([[], [[999, 0.8]], [[10, null]], [[10, ""]]].map((data) => [data]))(
    "paged response-wide count preserves empty-cache fallback (%j)",
    async (data) => {
        const response = { column: null, data }
        expect(
            await parseReviewRetrievabilityPages(
                stream(pages(response, data)),
                EMPTY_CALIBRATION_SAMPLES
            )
        ).toEqual(
            parseReviewRetrievabilityResponse(JSON.stringify(response), EMPTY_CALIBRATION_SAMPLES)
        )
    }
)

test.each([
    '{"format":"prediction-pages-v1","row_count":1}\n{"done":true}',
    '{"format":"prediction-pages-v1","row_count":0}\n',
    '{}\n{"done":true}',
    '{"format":"prediction-pages-v1","row_count":0}\n{"done":true}\n{}',
    "invalid",
    pages({}, [
        [20, 0.8],
        [10, 0.9],
    ]),
])("malformed or incomplete pages cannot publish a partial cohort", async (text) => {
    await expect(
        parseReviewRetrievabilityPages(stream(text), EMPTY_CALIBRATION_SAMPLES)
    ).rejects.toThrow()
})

test("page parsing cancels the response body after a malformed page", async () => {
    const cancel = jest.fn()
    const input = new ReadableStream<Uint8Array>({
        start(c) {
            c.enqueue(new TextEncoder().encode("{}\n"))
        },
        cancel,
    })
    await expect(parseReviewRetrievabilityPages(input, EMPTY_CALIBRATION_SAMPLES)).rejects.toThrow(
        "metadata"
    )
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(input.locked).toBe(false)
})

test("a rejected body read cannot return partial predictions", async () => {
    const input = new ReadableStream<Uint8Array>({
        start(c) {
            c.error(new DOMException("Cancelled", "AbortError"))
        },
    })
    await expect(
        parseReviewRetrievabilityPages(input, EMPTY_CALIBRATION_SAMPLES)
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(input.locked).toBe(false)
})
