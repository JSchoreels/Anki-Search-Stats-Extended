import type { CalibrationSample } from "./MemorisedBar"
import { dayFromMs } from "./revlogGraphs"

export type RwkvDailyPoint = {
    day: number
    count: number
    actualRecall: number
    predictedRecall: number
    standardizedGap: number | null
    logLoss: number
}

export type RwkvDailyMetric = "standardizedGap" | "logLoss"

// Keep impossible outcomes finite without altering the probabilities used for R or variance.
const MIN_OUTCOME_PROBABILITY = 1e-15

export function buildRwkvDailyData(
    samples: CalibrationSample[],
    predictions: Record<number, number>
): RwkvDailyPoint[] {
    const days = new Map<
        number,
        { count: number; actual: number; predicted: number; variance: number; loss: number }
    >()

    for (const sample of samples) {
        const p = predictions[sample.revlogId]
        if (
            typeof p !== "number" ||
            !Number.isFinite(p) ||
            p < 0 ||
            p > 1 ||
            !Number.isFinite(sample.revlogId) ||
            (sample.actual !== 0 && sample.actual !== 1)
        ) {
            continue
        }

        const day = dayFromMs(sample.revlogId)
        const totals = days.get(day) ?? { count: 0, actual: 0, predicted: 0, variance: 0, loss: 0 }
        totals.count += 1
        totals.actual += sample.actual
        totals.predicted += p
        totals.variance += p * (1 - p)
        const outcomeProbability = sample.actual === 1 ? p : 1 - p
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
