import { type CalibrationSamples, sampleCount } from "./calibrationSamples"
import { dailyMovingAverage, studyDayMovingAverage } from "./dailyMovingAverage"
import { dayFromMs } from "./revlogGraphs"

export type DailyPredictionPoint = {
    day: number
    count: number
    actualRecall: number
    actualCount?: number
    predictedRecall: number
    standardizedGap: number | null
    logLoss: number
}

export type DailyPredictionMetric = "standardizedGap" | "logLoss"
export type DailyPredictionDisplayMetric = DailyPredictionMetric | "rawGap"

export function dailyPredictionValue(
    point: DailyPredictionPoint,
    metric: DailyPredictionDisplayMetric
): number | null {
    return metric === "rawGap" ? (point.actualRecall - point.predictedRecall) * 100 : point[metric]
}

export function dailyPredictionAverage(
    data: DailyPredictionPoint[],
    metric: DailyPredictionDisplayMetric,
    days: number,
    mode: "calendar" | "study" = "calendar"
): (number | null)[] {
    if (!data.length) return []
    if (mode === "study")
        return studyDayMovingAverage(
            data.map((point) => dailyPredictionValue(point, metric)),
            days
        )
    const firstDay = data[0].day
    const values = new Array<number | null>(data[data.length - 1].day - firstDay + 1).fill(null)
    for (const point of data) values[point.day - firstDay] = dailyPredictionValue(point, metric)
    const averaged = dailyMovingAverage(values, days)
    return data.map((point) => averaged[point.day - firstDay])
}

// Keep impossible outcomes finite without altering the probabilities used for R or variance.
const MIN_OUTCOME_PROBABILITY = 1e-15

export type DailyPredictionWindowValue = { day: number; value: number | null }

/** Calculate a trailing review-count window at the end of each eligible day. */
export function dailyPredictionReviewWindow(
    samples: CalibrationSamples,
    predictions: Float64Array,
    metric: DailyPredictionDisplayMetric,
    reviews: number
): DailyPredictionWindowValue[] {
    if (!Number.isSafeInteger(reviews) || reviews < 1) throw new Error("Invalid review window")
    const length = sampleCount(samples)
    if (!length) return []
    let chronological = true
    let previous = -Infinity
    for (const id of samples.revlogIds) {
        if (!Number.isFinite(id)) continue
        if (id < previous) chronological = false
        previous = id
    }
    const order = chronological
        ? undefined
        : Uint32Array.from({ length }, (_, index) => index).sort(
              (left, right) =>
                  (Number.isFinite(samples.revlogIds[left]) ? samples.revlogIds[left] : Infinity) -
                  (Number.isFinite(samples.revlogIds[right]) ? samples.revlogIds[right] : Infinity)
          )
    const capacity = Math.min(length, reviews)
    const values = new Float64Array(capacity)
    const variances = metric === "standardizedGap" ? new Float64Array(capacity) : undefined
    let sum = 0
    let variance = 0
    let nonzeroVariances = 0
    let count = 0
    let currentDay: number | undefined
    const result: DailyPredictionWindowValue[] = []
    const flush = () => {
        if (currentDay === undefined || !count) return
        const value =
            metric === "standardizedGap"
                ? variance > 0
                    ? sum / Math.sqrt(variance)
                    : null
                : sum / Math.min(count, capacity)
        result.push({ day: currentDay, value })
    }

    for (let position = 0; position < length; position++) {
        const index = order ? order[position] : position
        const id = samples.revlogIds[index]
        const actual = samples.actual[index]
        const predicted = predictions[index]
        if (
            !Number.isFinite(id) ||
            (actual !== 0 && actual !== 1) ||
            !Number.isFinite(predicted) ||
            predicted < 0 ||
            predicted > 1
        )
            continue
        const day = dayFromMs(id)
        if (day !== currentDay) {
            flush()
            currentDay = day
        }
        const slot = count % capacity
        if (count >= capacity) {
            sum -= values[slot]
            if (variances) {
                variance -= variances[slot]
                if (variances[slot] > 0) nonzeroVariances--
            }
        }
        const value =
            metric === "logLoss"
                ? -Math.log2(Math.max(MIN_OUTCOME_PROBABILITY, actual ? predicted : 1 - predicted))
                : (actual - predicted) * (metric === "rawGap" ? 100 : 1)
        values[slot] = value
        sum += value
        if (variances) {
            variances[slot] = predicted * (1 - predicted)
            variance += variances[slot]
            if (variances[slot] > 0) nonzeroVariances++
            if (!nonzeroVariances) variance = 0
        }
        count++
    }
    flush()
    return result
}

export function buildDailyPredictionData(
    samples: CalibrationSamples,
    predictions: Float64Array
): DailyPredictionPoint[] {
    const days = new Map<
        number,
        { count: number; actual: number; predicted: number; variance: number; loss: number }
    >()

    for (let i = 0; i < sampleCount(samples); i++) {
        const p = predictions[i]
        if (
            typeof p !== "number" ||
            !Number.isFinite(p) ||
            p < 0 ||
            p > 1 ||
            !Number.isFinite(samples.revlogIds[i]) ||
            (samples.actual[i] !== 0 && samples.actual[i] !== 1)
        ) {
            continue
        }

        const day = dayFromMs(samples.revlogIds[i])
        const totals = days.get(day) ?? { count: 0, actual: 0, predicted: 0, variance: 0, loss: 0 }
        totals.count += 1
        totals.actual += samples.actual[i]
        totals.predicted += p
        totals.variance += p * (1 - p)
        const outcomeProbability = samples.actual[i] === 1 ? p : 1 - p
        totals.loss -= Math.log2(Math.max(MIN_OUTCOME_PROBABILITY, outcomeProbability))
        days.set(day, totals)
    }

    return [...days.entries()]
        .sort(([left], [right]) => left - right)
        .map(([day, totals]) => ({
            day,
            count: totals.count,
            actualRecall: totals.actual / totals.count,
            predictedRecall: totals.predicted / totals.count,
            standardizedGap:
                totals.variance > 0
                    ? (totals.actual - totals.predicted) / Math.sqrt(totals.variance)
                    : null,
            logLoss: totals.loss / totals.count,
        }))
}
