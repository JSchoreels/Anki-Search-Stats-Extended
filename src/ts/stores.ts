import { derived, get, writable, type Readable } from "svelte/store"
import { calculateCardDataPies } from "./CardDataPies"
import { DEFAULT_ORDER, type SSEconfig, type SSEother } from "./config"
import { latestResult } from "./latestResult"
import type { buildCalibrationBins, getMemorisedDays } from "./MemorisedBar"
import type { GraphsRequest, GraphsResponse } from "./proto/anki/stats_pb"
import { today, type calculateRevlogStats } from "./revlogGraphs"
import {
    cancelRwkvMemorisedHistory,
    catchErrors,
    ensureFsrsCalibration,
    getCardData,
    getFsrsPresetData,
    getFsrsReviewRetrievability,
    getRevlogs,
    getRwkvMemorisedHistoryProgress,
    getRwkvReviewRetrievability,
    saveConfigValue,
    startRwkvMemorisedHistory,
    type CardData,
    type FsrsCalibrationProgress,
    type Revlog,
} from "./search"
import { runStatsTask } from "./statsWorkerClient"
import type { Tooltip } from "./tooltip"

// Pie chart related
export let include_suspended = writable(false)
export let zero_inclusive = writable(false)
export let custom_pie_mode = writable("Count")
export let custom_bar_mode = writable<"count" | "time">("count")
export let graph_mode = writable<"Bar" | "Pie">("Pie")

// Config related stats
export let other = writable<SSEother>()
export let config = writable<SSEconfig>()
export let shownCategories = writable(SSEconfig.categories ?? {})
export let autoRevlogStats = writable(SSEconfig.autoRevlogStats ?? false)
export let autoMemorisedStats = writable(SSEconfig.autoMemorisedStats ?? false)
export let alwaysAllTime = writable(SSEconfig.alwaysAllTime ?? false)
export type CalibrationMode = "fsrs" | "rwkv" | "both"
export let calibrationMode = writable<CalibrationMode>("fsrs")
export type MemorisedMode = "fsrs" | "rwkv" | "both"
export let memorisedMode = writable<MemorisedMode>("fsrs")
export let categoryOrder = writable([
    ...(SSEconfig.categoryOrder ?? []).filter((c) => DEFAULT_ORDER.includes(c)),
    ...DEFAULT_ORDER.filter((c) => !(SSEconfig.categoryOrder ?? []).includes(c)),
])
export let showRevlogStats = writable(false)
export let showFsrsStats = writable(SSEconfig.autoMemorisedStats)

function configSubscribe<T>(store: Readable<T>, run: (value: T) => void) {
    let first = true
    return store.subscribe((value) => {
        if (first) {
            first = false
        } else {
            run(value)
        }
    })
}

configSubscribe(shownCategories, ($shownCategories) =>
    saveConfigValue("categories", $shownCategories)
)

configSubscribe(autoRevlogStats, ($autoRevlogStats) => {
    saveConfigValue("autoRevlogStats", $autoRevlogStats)
    if ($autoRevlogStats) {
        showRevlogStats.set($autoRevlogStats)
    }
})

configSubscribe(categoryOrder, ($categoryOrder) => saveConfigValue("categoryOrder", $categoryOrder))

configSubscribe(autoMemorisedStats, ($autoMemorisedStats) => {
    saveConfigValue("autoMemorisedStats", $autoMemorisedStats)
    if ($autoMemorisedStats || !get(showRevlogStats)) {
        showFsrsStats.set($autoMemorisedStats)
    }
})

configSubscribe(alwaysAllTime, ($alwaysAllTime) => saveConfigValue("alwaysAllTime", $alwaysAllTime))

// Data related
export let data = writable<null | GraphsResponse>(null)

export let graphsRequest = writable<null | GraphsRequest>(null)
export let searchString = derived(graphsRequest, ($graphsRequest) => $graphsRequest?.search ?? null)
export let searchLimit = derived(
    [graphsRequest, alwaysAllTime],
    ([$graphsRequest, $alwaysAllTime]) => ($alwaysAllTime ? 0 : ($graphsRequest?.days ?? 0))
)
export let cids = writable<null | number[]>(null)
export const rwkvStatsGeneration = writable(0)

// Revlog graph specific stores
export let pieLast = writable(59)
export let pieSteps = writable(10)
export let scroll = writable(0)
export let binSize = writable(1)

//Tooltip related stores
export let tooltip = writable<Tooltip>({
    text: [""],
    x: 0,
    y: 0,
})
export let tooltipShown = writable(false)

cids.subscribe(() => showRevlogStats.set(get(autoRevlogStats) || false))
tooltipShown.subscribe(() =>
    setTimeout(() => {
        if (!get(tooltipShown)) {
            tooltip.update(($tooltip) => ({ text: $tooltip.text, x: 0, y: 0 }))
        }
    }, 1000)
)
config.subscribe(($config) =>
    graph_mode.set($config?.graphMode?.toLowerCase() == "bar" ? "Bar" : "Pie")
)

// Stats Data Stores
export let card_data: Readable<CardData[] | null> = derived([cids], ([$cids], set) => {
    set(null)
    if ($cids) {
        return latestResult(set, () => getCardData($cids))
    }
})

// Shared by current-state heatmaps, preset-specific curves and historical replay.
const needsFsrsData = derived(
    [showRevlogStats, shownCategories],
    ([$showRevlogs, $categories]) =>
        $showRevlogs || ($categories.misc !== false && $categories.misc !== "removed")
)
export const fsrsPresetData = derived(
    [card_data, needsFsrsData],
    (
        [$cards, $needed],
        set: (value: Awaited<ReturnType<typeof getFsrsPresetData>> | null) => void
    ) => {
        set(null)
        if ($cards && $needed)
            return latestResult(set, () => getFsrsPresetData($cards.map((card) => card.id)))
    }
)

export let revlogs: Readable<Revlog[] | null> = derived(
    [cids, showRevlogStats, searchLimit],
    ([$cids, $showRevlogStats, $searchLimit], set) => {
        set(null)
        if ($cids && $showRevlogStats) {
            return latestResult(set, () => getRevlogs($cids, $searchLimit))
        }
    }
)

export let cardDataStats = derived(
    [card_data, include_suspended, zero_inclusive],
    ([$card_data, $include_suspended, $zero_inclusive]) =>
        calculateCardDataPies($card_data ?? [], $include_suspended, $zero_inclusive)
)
export const revlogStats = writable<ReturnType<typeof calculateRevlogStats> | null>(null)
derived(
    [revlogs, card_data, fsrsPresetData],
    ([$revlogs, $card_data, $presets], set: typeof revlogStats.set) => {
        set(null)
        if ($revlogs && $card_data && $presets) {
            return latestResult(set, (signal) =>
                runStatsTask(
                    "revlog",
                    [$revlogs, $card_data, today, $presets.presetsByCard],
                    signal
                )
            )
        }
    }
).subscribe(revlogStats.set)
export let last_forget = derived([revlogStats], ([$revlogStats]) => $revlogStats?.last_forget)
export let memorised_stats = writable<Awaited<ReturnType<typeof getMemorisedDays>> | null>()
derived(
    [card_data, revlogs, showFsrsStats, last_forget, fsrsPresetData],
    (
        [$card_data, $revlogs, $showFsrsStats, $last_forget, $presets],
        set: (value: Awaited<ReturnType<typeof getMemorisedDays>> | null) => void
    ) => {
        set(null)
        if ($revlogs && $card_data && $showFsrsStats && $last_forget && $presets) {
            return latestResult(set, async (signal) => {
                return runStatsTask(
                    "memorised",
                    [
                        $revlogs,
                        $card_data,
                        SSEother.deck_configs,
                        SSEother.deck_config_ids,
                        $last_forget,
                        2,
                        2,
                        $presets.presetsByCard,
                    ],
                    signal
                )
            })
        }
    }
).subscribe(memorised_stats.set)

export type RwkvMemorisedStats = {
    phase: string
    current: number
    total: number
    firstDay: number | null
    completedThroughDay: number | null
    retrievabilityDays: number[]
    noteRetrievabilityDays: number[]
    totalCards: number[]
    done: boolean
    error: string | null
}

export let rwkvMemorisedStats = writable<RwkvMemorisedStats | null>(null)
let rwkvMemorisedGeneration = 0

function anchoredRwkvDays(values: number[] | undefined, firstDay: number | null | undefined) {
    const result: number[] = []
    if (firstDay === null || firstDay === undefined) {
        return result
    }
    const firstUnixDay = today + (firstDay - SSEother.days_elapsed)
    for (const [index, value] of (values ?? []).entries()) {
        result[firstUnixDay + index] = value
    }
    return result
}

derived(
    [memorisedMode, cids, showFsrsStats],
    ([$memorisedMode, $cids, $showFsrsStats], set: (value: RwkvMemorisedStats | null) => void) => {
        const generation = ++rwkvMemorisedGeneration
        set(null)
        if ($memorisedMode === "fsrs" || !$cids || !$showFsrsStats) {
            return
        }

        catchErrors(async () => {
            let progress = await startRwkvMemorisedHistory($cids)
            while (generation === rwkvMemorisedGeneration) {
                const firstDay = progress.firstDay ?? null
                set({
                    phase: progress.phase,
                    current: progress.current ?? 0,
                    total: progress.total ?? 0,
                    firstDay,
                    completedThroughDay: progress.completedThroughDay ?? null,
                    retrievabilityDays: anchoredRwkvDays(progress.retrievabilityByDay, firstDay),
                    noteRetrievabilityDays: anchoredRwkvDays(
                        progress.noteRetrievabilityByDay,
                        firstDay
                    ),
                    totalCards: anchoredRwkvDays(progress.cardCountByDay, firstDay),
                    done: progress.done,
                    error: progress.error ?? null,
                })
                if (progress.done) {
                    return
                }
                await new Promise((resolve) => setTimeout(resolve, 500))
                progress = await getRwkvMemorisedHistoryProgress($cids)
            }
        })

        return () => {
            if (generation === rwkvMemorisedGeneration) {
                rwkvMemorisedGeneration += 1
            }
        }
    }
).subscribe(rwkvMemorisedStats.set)

export async function cancelRwkvMemorisedComputation() {
    rwkvMemorisedGeneration += 1
    rwkvMemorisedStats.update((stats) =>
        stats ? { ...stats, phase: "checkpointing", done: false } : stats
    )
    try {
        await cancelRwkvMemorisedHistory()
    } finally {
        rwkvMemorisedStats.update((stats) =>
            stats ? { ...stats, phase: "cancelled", done: true } : stats
        )
    }
}

export type FsrsCalibrationStats = {
    cachedPredictionCount: number
    roles: string[]
    column: string | null
    bins: ReturnType<typeof buildCalibrationBins>
    predictionsByRevlogId: Record<number, number>
    warnings: string[]
}
export let fsrsCalibrationGeneration = writable<FsrsCalibrationProgress | null>(null)
export let fsrsCalibrationRevision = writable(0)

const preparedCalibrationCards = new Set<number>()
let calibrationRunning = false
let calibrationStopped = false

async function prepareFsrsCalibration(cardIds: number[]) {
    if (
        calibrationRunning ||
        calibrationStopped ||
        !cardIds.length ||
        cardIds.every((id) => preparedCalibrationCards.has(id))
    )
        return
    calibrationRunning = true
    fsrsCalibrationGeneration.set({
        phase: "queued",
        label: "Preparing historical FSRS calibration",
        warnings: [],
    })
    await ensureFsrsCalibration(
        cardIds,
        new AbortController().signal,
        fsrsCalibrationGeneration.set
    )
    if (get(fsrsCalibrationGeneration)?.phase === "ready") {
        cardIds.forEach((id) => preparedCalibrationCards.add(id))
    } else {
        // Cancellation/failure stops automatic retries until this stats page reopens.
        calibrationStopped = true
    }
    fsrsCalibrationRevision.update((revision) => revision + 1)
    calibrationRunning = false
    const currentCards = get(cids)
    if (currentCards?.length && get(memorised_stats)?.calibration_samples?.length) {
        void prepareFsrsCalibration(currentCards)
    }
}

derived([cids, memorised_stats], ([$cids, $memorised]) => {
    if ($cids?.length && $memorised?.calibration_samples?.length) {
        void prepareFsrsCalibration([...$cids])
    }
}).subscribe(() => {})

export let fsrsCalibrationStats = writable<FsrsCalibrationStats | null>(null)
derived(
    [cids, searchLimit, memorised_stats, fsrsCalibrationRevision],
    (
        [$cids, $searchLimit, $memorised_stats],
        set: (value: FsrsCalibrationStats | null) => void
    ) => {
        set(null)
        if (!$cids || !$memorised_stats) {
            return
        }

        const samples = $memorised_stats.calibration_samples ?? []
        if (samples.length === 0) {
            set({
                column: null,
                bins: [],
                predictionsByRevlogId: {},
                warnings: [],
                cachedPredictionCount: 0,
                roles: [],
            })
            return
        }

        return latestResult(set, async (signal) => {
            const { column, predictionsByRevlogId, warnings, roles } =
                await getFsrsReviewRetrievability(
                    $cids,
                    $searchLimit,
                    samples.map((sample) => sample.revlogId)
                )
            const effectivePredictions =
                Object.keys(predictionsByRevlogId).length > 0
                    ? predictionsByRevlogId
                    : $memorised_stats.fsrs_calibration_predictions_by_revlog_id
            return {
                column,
                cachedPredictionCount: Object.keys(predictionsByRevlogId).length,
                roles,
                bins: await runStatsTask("calibration", [samples, effectivePredictions], signal),
                predictionsByRevlogId: effectivePredictions,
                warnings,
            }
        })
    }
).subscribe(fsrsCalibrationStats.set)

export type RwkvCalibrationStats = {
    column: string | null
    bins: ReturnType<typeof buildCalibrationBins>
    predictionsByRevlogId: Record<number, number>
    warnings: string[]
    roles?: string[]
    roleCounts?: Record<string, number>
}
export let rwkvCalibrationStats = writable<RwkvCalibrationStats | null>(null)
derived(
    [cids, searchLimit, memorised_stats, rwkvStatsGeneration, fsrsCalibrationRevision],
    (
        [$cids, $searchLimit, $memorised_stats, , $fsrsCalibrationRevision],
        set: (value: RwkvCalibrationStats | null) => void
    ) => {
        set(null)
        if (!$cids || !$memorised_stats) {
            return
        }

        const samples = $memorised_stats.calibration_samples ?? []
        if (samples.length === 0) {
            set({ column: null, bins: [], predictionsByRevlogId: {}, warnings: [] })
            return
        }

        return latestResult(set, async (signal) => {
            const { column, predictionsByRevlogId, warnings, roles, roleCounts } =
                await getRwkvReviewRetrievability(
                    $cids,
                    $searchLimit,
                    samples.map((sample) => sample.revlogId),
                    $fsrsCalibrationRevision > 0 &&
                        get(fsrsCalibrationGeneration)?.phase === "ready"
                )
            return {
                column,
                bins: await runStatsTask("calibration", [samples, predictionsByRevlogId], signal),
                predictionsByRevlogId,
                warnings,
                roles,
                roleCounts,
            }
        })
    }
).subscribe(rwkvCalibrationStats.set)
