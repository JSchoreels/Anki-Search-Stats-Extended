import type { CalibrationSamples } from "./calibrationSamples"
import type { DailyPredictionPoint, DailyPredictionWindowValue } from "./dailyPredictionData"
import { asRevlogHistory, type RevlogInput } from "./packedRevlogs"
import { dayFromMs } from "./revlogGraphs"

export type DailyActualRecall = Record<number, { count: number; remembered: number }>
export type DailyModelPredictions = { model: string; predictions: Float64Array }
const graded = (ease: number) => Number.isInteger(ease) && ease >= 1 && ease <= 4

// Include every graded review in the search, including same-day repetitions and filtered reviews.
export function dailyActualRecall(input: RevlogInput): DailyActualRecall {
    const days: DailyActualRecall = {}
    for (const review of asRevlogHistory(input)) {
        if (!Number.isFinite(review.id) || !graded(review.ease)) continue
        const day = dayFromMs(review.id)
        const totals = (days[day] ??= { count: 0, remembered: 0 })
        totals.count++
        if (review.ease > 1) totals.remembered++
    }
    return days
}

export function applyDailyActualRecall(
    points: DailyPredictionPoint[],
    actual: DailyActualRecall
): DailyPredictionPoint[] {
    return points.flatMap((point) => {
        const day = actual[point.day]
        return day?.count
            ? [{ ...point, actualRecall: day.remembered / day.count, actualCount: day.count }]
            : []
    })
}

/** Last N graded reviews: compare their observed recall with available model predictions. */
export function dailyRecallModelReviewWindows(
    input: RevlogInput,
    samples: CalibrationSamples,
    sources: DailyModelPredictions[],
    reviews: number
): Record<string, DailyPredictionWindowValue[]> {
    if (!Number.isSafeInteger(reviews) || reviews < 1) throw new Error("Invalid review window")
    const history = asRevlogHistory(input)
    const result: Record<string, DailyPredictionWindowValue[]> = Object.fromEntries(
        sources.map(({ model }) => [model, []])
    )
    if (!history.length || !sources.length) return result

    const sorted = (length: number, id: (index: number) => number) => {
        let previous = -Infinity
        for (let index = 0; index < length; index++) {
            const value = id(index)
            if (!Number.isFinite(value) || value < previous)
                return Uint32Array.from({ length }, (_, item) => item).sort(
                    (left, right) =>
                        (Number.isFinite(id(left)) ? id(left) : Infinity) -
                            (Number.isFinite(id(right)) ? id(right) : Infinity) || left - right
                )
            previous = value
        }
        return undefined
    }
    const historyOrder = sorted(history.length, (index) => history.id(index))
    const sampleOrder = sorted(samples.revlogIds.length, (index) => samples.revlogIds[index])
    const sampleId = (position: number) =>
        samples.revlogIds[sampleOrder ? sampleOrder[position] : position]
    const capacity = Math.min(history.length, reviews)
    const remembered = new Uint8Array(capacity)
    const probabilities = sources.map(() => new Float64Array(capacity).fill(NaN))
    const sums = sources.map(() => 0)
    const counts = sources.map(() => 0)
    let successes = 0
    let count = 0
    let position = 0
    let day: number | undefined
    const flush = () => {
        if (day === undefined || !count) return
        const actual = successes / Math.min(count, capacity)
        sources.forEach(({ model }, index) =>
            result[model].push({
                day: day!,
                value: counts[index] ? (actual - sums[index] / counts[index]) * 100 : null,
            })
        )
    }
    const row = history.cursor()
    for (let index = 0; index < history.length; index++) {
        row.index = historyOrder ? historyOrder[index] : index
        const id = row.id
        if (!Number.isFinite(id) || !graded(row.ease)) continue
        const currentDay = dayFromMs(id)
        if (currentDay !== day) {
            flush()
            day = currentDay
        }
        while (position < samples.revlogIds.length && sampleId(position) < id) position++
        const sampleIndex =
            position < samples.revlogIds.length && sampleId(position) === id
                ? sampleOrder
                    ? sampleOrder[position]
                    : position
                : undefined
        const slot = count % capacity
        if (count >= capacity) {
            successes -= remembered[slot]
            probabilities.forEach((values, model) => {
                if (Number.isFinite(values[slot])) {
                    sums[model] -= values[slot]
                    counts[model]--
                }
            })
        }
        remembered[slot] = row.ease > 1 ? 1 : 0
        successes += remembered[slot]
        sources.forEach(({ predictions }, model) => {
            const value =
                sampleIndex === undefined ||
                (samples.actual[sampleIndex] !== 0 && samples.actual[sampleIndex] !== 1)
                    ? NaN
                    : predictions[sampleIndex]
            probabilities[model][slot] =
                Number.isFinite(value) && value >= 0 && value <= 1 ? value : NaN
            if (Number.isFinite(probabilities[model][slot])) {
                sums[model] += probabilities[model][slot]
                counts[model]++
            }
        })
        count++
    }
    flush()
    return result
}
