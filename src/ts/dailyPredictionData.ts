import { type CalibrationSamples, sampleCount } from "./calibrationSamples"
import { dailyMovingAverage } from "./dailyMovingAverage"
import { dayFromMs } from "./revlogGraphs"

export type DailyPredictionPoint = {
    day: number
    count: number
    actualRecall: number
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
    days: number
): (number | null)[] {
    if (!data.length) return []
    const firstDay = data[0].day
    const values = new Array<number | null>(data[data.length - 1].day - firstDay + 1).fill(null)
    for (const point of data) values[point.day - firstDay] = dailyPredictionValue(point, metric)
    const averaged = dailyMovingAverage(values, days)
    return data.map((point) => averaged[point.day - firstDay])
}

// Keep impossible outcomes finite without altering the probabilities used for R or variance.
const MIN_OUTCOME_PROBABILITY = 1e-15

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
