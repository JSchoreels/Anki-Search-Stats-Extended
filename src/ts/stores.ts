import { derived, get, writable, type Readable } from "svelte/store"
import {
    activeRetrievabilityThresholds,
    type ActiveRetrievabilityHistory,
} from "./activeRetrievabilityMatrix"
import {
    alignPredictions,
    EMPTY_CALIBRATION_SAMPLES,
    heldOutFsrsPredictions,
    sampleCount,
    type CalibrationSamples,
} from "./calibrationSamples"
import { calculateCardDataPies } from "./CardDataPies"
import { DEFAULT_ORDER, type SSEconfig, type SSEother } from "./config"
import { exposureStabilityThresholds } from "./exposureStabilityMatrix"
import { createGraphFavorites } from "./graphFavorites"
import { createGraphPreference, graphIsVisible } from "./graphPreferences"
import { latestResult } from "./latestResult"
import type { MaturationHistory } from "./maturation"
import {
    withConfidenceIntervals,
    type buildCalibrationBins,
    type getMemorisedDays,
} from "./MemorisedBar"
import type { GraphsRequest, GraphsResponse } from "./proto/anki/stats_pb"
import { today, type calculateRevlogStats } from "./revlogGraphs"
import {
    cancelRwkvMemorisedHistory,
    cancelRwkvReviewGain,
    catchErrors,
    ensureFsrsCalibration,
    getCardData,
    getFsrsPresetData,
    getReviewRetrievabilityPages,
    getRwkvMemorisedHistoryProgress,
    getRwkvReviewGainProgress,
    saveConfigValue,
    startRwkvMemorisedHistory,
    startRwkvReviewGain,
    type CardData,
    type FsrsCalibrationProgress,
} from "./search"
import type { StatsHistory } from "./statsHistory"
import type { Tasks } from "./statsTasks"
import { loadStatsHistory, runStatsTask } from "./statsWorkerClient"
import type { Tooltip } from "./tooltip"

// Pie chart related
export let include_suspended = writable(false)
export let zero_inclusive = writable(false)
export let custom_pie_mode = writable("Count")
export let custom_bar_mode = writable<"count" | "time">("count")
export let graph_mode = writable<"Bar" | "Pie">("Pie")

// Config related stats
export let other = writable<SSEother>()
export const exposureStabilitySettings = writable(
    exposureStabilityThresholds(SSEconfig.exposureStabilityThresholds)
)
export const activeRetrievabilitySettings = writable(
    activeRetrievabilityThresholds(SSEconfig.activeRetrievabilityThresholds)
)
export const maturationSmoothing = writable({ enabled: false, days: 7 })
export let config = writable<SSEconfig>()
export let shownCategories = writable(SSEconfig.categories ?? {})
export const favoriteGraphs = createGraphFavorites(SSEconfig.pinnedGraphs, async (ids) => {
    await saveConfigValue("pinnedGraphs", ids)
    SSEconfig.pinnedGraphs = ids
})
export const hiddenGraphs = {
    ...createGraphPreference(
        SSEconfig.hiddenGraphs,
        async (ids) => {
            await saveConfigValue("hiddenGraphs", ids)
            SSEconfig.hiddenGraphs = ids
        },
        "Failed to save hidden graphs"
    ),
    target: writable<HTMLElement | null>(null),
}
export const showHiddenGraphs = writable(false)
hiddenGraphs.ids.subscribe((ids) => {
    if (!ids.length) showHiddenGraphs.set(false)
})
export let autoRevlogStats = writable(SSEconfig.autoRevlogStats ?? false)
export let autoMemorisedStats = writable(SSEconfig.autoMemorisedStats ?? false)
export let alwaysAllTime = writable(SSEconfig.alwaysAllTime ?? false)
export type CalibrationMode = "fsrs" | "rwkv" | "both"
export let calibrationMode = writable<CalibrationMode>("fsrs")
export type MemorisedMode = "fsrs" | "rwkv" | "both"
export let memorisedMode = writable<MemorisedMode>("fsrs")
export let memorisedPerReviewMode = writable<MemorisedMode>("fsrs")
export const reviewGainHorizon = writable<0 | 600 | 3600 | 86400>(0)
export let categoryOrder = writable([
    ...(SSEconfig.categoryOrder ?? []).filter((c) => DEFAULT_ORDER.includes(c)),
    ...DEFAULT_ORDER.filter((c) => !(SSEconfig.categoryOrder ?? []).includes(c)),
])
export let showRevlogStats = writable(false)
export const showMaturationStats = writable(false)
export let showFsrsStats = writable(SSEconfig.autoMemorisedStats)
export const showMemorisedStats = writable(SSEconfig.autoMemorisedStats ?? false)

// Comparison/calibration loading does not request the separate historical replay.
export function requestFsrsStats(includeMemorised = false) {
    if (includeMemorised) showMemorisedStats.set(true)
    showRevlogStats.set(true)
    showFsrsStats.set(true)
}

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
        showMemorisedStats.set($autoMemorisedStats)
        showFsrsStats.set($autoMemorisedStats)
    }
})

configSubscribe(alwaysAllTime, ($alwaysAllTime) => saveConfigValue("alwaysAllTime", $alwaysAllTime))
configSubscribe(exposureStabilitySettings, (settings) =>
    saveConfigValue("exposureStabilityThresholds", settings)
)

configSubscribe(activeRetrievabilitySettings, (settings) =>
    saveConfigValue("activeRetrievabilityThresholds", settings)
)

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

export const activeRetrievabilityRequested = writable(false)

// Shared by current-state heatmaps, preset-specific curves and historical replay.
const needsFsrsData = derived(
    [
        showRevlogStats,
        shownCategories,
        showMaturationStats,
        activeRetrievabilityRequested,
        favoriteGraphs.pinned,
        hiddenGraphs.ids,
        showHiddenGraphs,
    ],
    ([$showRevlogs, $categories, $maturation, $activeR, $pinned, $hidden, $showHidden]) => {
        const visible = (id: string, category: string) =>
            graphIsVisible(
                id,
                $categories[category] !== false && $categories[category] !== "removed",
                $pinned,
                $hidden,
                $showHidden
            )
        return (
            $activeR ||
            $showRevlogs ||
            visible("misc:sxr-heatmap", "misc") ||
            visible("misc:ease-factors", "misc") ||
            ($maturation &&
                (visible("introduced:maturation-counts", "introduced") ||
                    visible("introduced:maturation-ratios", "introduced")))
        )
    }
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

export const activeRetrievabilityHistory = derived(
    [card_data, fsrsPresetData, activeRetrievabilityRequested],
    ([$cards, $presets, $requested], set: (value: ActiveRetrievabilityHistory | null) => void) => {
        set(null)
        if ($requested && $cards && $presets)
            return latestResult(set, async (signal) => {
                const history = await loadStatsHistory(
                    $cards.map((card) => card.id),
                    0,
                    signal
                )
                try {
                    return await runStatsTask(
                        "activeRetrievability",
                        [history, $cards, $presets.presetsByCard],
                        signal
                    )
                } finally {
                    history.dispose()
                }
            })
    }
)

export const maturationHistory = derived(
    [card_data, fsrsPresetData, showMaturationStats],
    ([$cards, $presets, $requested], set: (value: MaturationHistory | null) => void) => {
        set(null)
        if ($requested && $cards && $presets)
            return latestResult(set, async (signal) => {
                const history = await loadStatsHistory(
                    $cards.map((card) => card.id),
                    0,
                    signal
                )
                try {
                    return await runStatsTask(
                        "maturation",
                        [history, $cards, $presets.presetsByCard],
                        signal
                    )
                } finally {
                    history.dispose()
                }
            })
    }
)

export let revlogs: Readable<StatsHistory | null> = derived(
    [cids, showRevlogStats, searchLimit],
    ([$cids, $showRevlogStats, $searchLimit], set) => {
        set(null)
        if ($cids && $showRevlogStats) {
            return latestResult(set, (signal) => loadStatsHistory($cids, $searchLimit, signal))
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
export let last_forget = derived([revlogs], ([$revlogs]) => $revlogs?.lastForget)
export let memorised_stats = writable<Awaited<ReturnType<typeof getMemorisedDays>> | null>()
derived(
    [card_data, revlogs, showFsrsStats, last_forget, fsrsPresetData, showMemorisedStats],
    (
        [$card_data, $revlogs, $showFsrsStats, $last_forget, $presets, $requested],
        set: (value: Awaited<ReturnType<typeof getMemorisedDays>> | null) => void
    ) => {
        set(null)
        if ($requested && $revlogs && $card_data && $showFsrsStats && $last_forget && $presets) {
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

export const calibration_samples = writable<CalibrationSamples | null>(null)
derived(
    [card_data, revlogs, showFsrsStats, fsrsPresetData],
    ([$cards, $revlogs, $show, $presets], set: typeof calibration_samples.set) => {
        set(null)
        if ($cards && $revlogs && $show && $presets) {
            return latestResult(set, (signal) =>
                runStatsTask(
                    "calibrationSamples",
                    [
                        $revlogs,
                        $cards,
                        SSEother.deck_configs,
                        SSEother.deck_config_ids,
                        $presets.presetsByCard,
                    ],
                    signal
                )
            )
        }
    }
).subscribe(calibration_samples.set)

function waitForMemorised(
    signal: AbortSignal
): Promise<Awaited<ReturnType<typeof getMemorisedDays>>> {
    return new Promise((resolve, reject) => {
        let unsubscribe = () => {}
        const abort = () => {
            unsubscribe()
            reject(new DOMException("Aborted", "AbortError"))
        }
        if (signal.aborted) return abort()
        showMemorisedStats.set(true)
        signal.addEventListener("abort", abort, { once: true })
        const stop = memorised_stats.subscribe((value) => {
            if (value) {
                signal.removeEventListener("abort", abort)
                resolve(value)
                unsubscribe()
            }
        })
        unsubscribe = stop
        if (get(memorised_stats)) stop()
    })
}

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

const rwkvMemorisedRequested = derived(memorisedMode, ($mode) => $mode !== "fsrs")

derived(
    [rwkvMemorisedRequested, cids, showMemorisedStats],
    ([$rwkvRequested, $cids, $requested], set: (value: RwkvMemorisedStats | null) => void) => {
        const generation = ++rwkvMemorisedGeneration
        set(null)
        if (!$rwkvRequested || !$cids || !$requested) {
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

export type RwkvReviewGainStats = {
    jobId: number | null
    phase: string
    current: number
    total: number
    gainDays: number[]
    withDays: number[]
    withoutDays: number[]
    countDays: number[]
    slowReplay: boolean
    done: boolean
    error: string | null
}

export const rwkvReviewGainStats = writable<RwkvReviewGainStats | null>(null)
let rwkvReviewGainGeneration = 0
let rwkvReviewGainRequests = Promise.resolve()

// Keep starts and cancellations in order when the search or selected model changes quickly.
function queueRwkvReviewGainRequest<T>(request: () => Promise<T>): Promise<T> {
    const result = rwkvReviewGainRequests.then(request)
    rwkvReviewGainRequests = result.then(
        () => {},
        () => {}
    )
    return result
}

derived(
    [memorisedPerReviewMode, cids, showMemorisedStats, searchLimit, reviewGainHorizon],
    (
        [$mode, $cids, $requested, $limit, $horizon],
        set: (value: RwkvReviewGainStats | null) => void
    ) => {
        const generation = ++rwkvReviewGainGeneration
        set(null)
        if ($mode === "fsrs" || !$cids || !$requested) return
        let jobId: number | null = null
        let finished = false
        void (async () => {
            try {
                let progress = await queueRwkvReviewGainRequest(async () => {
                    if (generation !== rwkvReviewGainGeneration) return null
                    const started = await startRwkvReviewGain($cids, $limit, $horizon)
                    if (generation !== rwkvReviewGainGeneration) {
                        if (started.jobId !== undefined && !started.done)
                            await cancelRwkvReviewGain(started.jobId)
                        return null
                    }
                    return started
                })
                if (!progress) return
                jobId = progress.jobId ?? null
                if (generation !== rwkvReviewGainGeneration) {
                    if (jobId !== null && !progress.done)
                        await queueRwkvReviewGainRequest(() => cancelRwkvReviewGain(jobId!))
                    return
                }
                while (generation === rwkvReviewGainGeneration) {
                    set({
                        jobId,
                        phase: progress.phase,
                        current: progress.current ?? 0,
                        total: progress.total ?? 0,
                        gainDays: anchoredRwkvDays(progress.gainByDay, progress.firstDay),
                        withDays: anchoredRwkvDays(progress.withByDay, progress.firstDay),
                        withoutDays: anchoredRwkvDays(progress.withoutByDay, progress.firstDay),
                        countDays: anchoredRwkvDays(progress.countByDay, progress.firstDay),
                        slowReplay: progress.slowReplay === true,
                        done: progress.done,
                        error: progress.error ?? null,
                    })
                    if (progress.done) {
                        finished = true
                        return
                    }
                    if (jobId === null)
                        throw new Error("RWKV review replay did not return a job ID")
                    await new Promise((resolve) => setTimeout(resolve, 500))
                    if (generation !== rwkvReviewGainGeneration) return
                    progress = await getRwkvReviewGainProgress(jobId)
                }
            } catch (error) {
                if (jobId !== null && !finished) {
                    void queueRwkvReviewGainRequest(() => cancelRwkvReviewGain(jobId!)).catch(
                        () => {}
                    )
                }
                if (generation === rwkvReviewGainGeneration) {
                    set({
                        jobId,
                        phase: "failed",
                        current: 0,
                        total: 0,
                        gainDays: [],
                        withDays: [],
                        withoutDays: [],
                        countDays: [],
                        slowReplay: false,
                        done: true,
                        error: error instanceof Error ? error.message : String(error),
                    })
                }
            }
        })()
        return () => {
            if (generation === rwkvReviewGainGeneration) rwkvReviewGainGeneration++
            if (jobId !== null && !finished)
                void queueRwkvReviewGainRequest(() => cancelRwkvReviewGain(jobId!)).catch(() => {})
        }
    }
).subscribe(rwkvReviewGainStats.set)

export async function cancelRwkvReviewGainComputation() {
    const stats = get(rwkvReviewGainStats)
    if (stats?.jobId !== null && stats?.jobId !== undefined && !stats.done) {
        await queueRwkvReviewGainRequest(() => cancelRwkvReviewGain(stats.jobId!))
    }
}

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
    predictions: Float64Array
    warnings: string[]
    bandsPending?: boolean
}
export let fsrsCalibrationGeneration = writable<FsrsCalibrationProgress | null>(null)
export let fsrsCalibrationRevision = writable(0)
const rwkvCalibrationRevision = writable(0)

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
    // Unchanged validation data must not clear/recompute graphs on every reopen.
    const cacheMayHaveChanged = get(fsrsCalibrationGeneration)?.generated !== false
    if (cacheMayHaveChanged) {
        fsrsCalibrationRevision.update((revision) => revision + 1)
        rwkvCalibrationRevision.update((revision) => revision + 1)
    }
    calibrationRunning = false
    const currentCards = get(cids)
    if (
        currentCards?.length &&
        sampleCount(get(calibration_samples) ?? EMPTY_CALIBRATION_SAMPLES)
    ) {
        void prepareFsrsCalibration(currentCards)
    }
}

derived([cids, calibration_samples], ([$cids, $samples]) => {
    if ($cids?.length && sampleCount($samples ?? EMPTY_CALIBRATION_SAMPLES)) {
        void prepareFsrsCalibration([...$cids])
    }
}).subscribe(() => {})

export let fsrsCalibrationStats = writable<FsrsCalibrationStats | null>(null)
derived(
    [cids, searchLimit, calibration_samples, fsrsCalibrationRevision],
    ([$cids, $searchLimit, samples], set: (value: FsrsCalibrationStats | null) => void) => {
        set(null)
        if (!$cids || !samples) {
            return
        }

        if (sampleCount(samples) === 0) {
            set({
                column: null,
                bins: [],
                predictions: new Float64Array(0),
                warnings: [],
                cachedPredictionCount: 0,
                roles: [],
            })
            return
        }

        return latestResult(set, async (signal) => {
            const text = await getReviewRetrievabilityPages(
                "fsrs",
                $cids,
                $searchLimit,
                samples.revlogIds,
                signal
            )
            const parsed = await runStatsTask("calibrationPredictions", [samples, text], signal)
            for (const warning of parsed.warnings) console.warn("Search Stats Extended:", warning)
            const stats = {
                column: parsed.column,
                cachedPredictionCount: parsed.responsePredictionCount,
                roles: parsed.roles,
                bins: parsed.bins,
                predictions: parsed.predictions,
                warnings: parsed.warnings,
            }
            if (parsed.responsePredictionCount === 0) {
                const memorised = await waitForMemorised(signal)
                const byId = new Map<number, number>()
                memorised.calibration_samples.revlogIds.forEach((id, i) =>
                    byId.set(id, memorised.fsrs_calibration_replay_predictions[i])
                )
                const predictions = alignPredictions(samples, byId)
                const bins = await runStatsTask("calibrationReplay", [samples, predictions], signal)
                return { ...stats, predictions, bins, bandsPending: false }
            }
            if (!signal.aborted) set({ ...stats, bandsPending: true })
            const intervals = await runStatsTask(
                "calibrationBands",
                [samples, parsed.predictions],
                signal
            )
            return {
                ...stats,
                bins: withConfidenceIntervals(parsed.bins, intervals),
                bandsPending: false,
            }
        })
    }
).subscribe(fsrsCalibrationStats.set)

export type RwkvCalibrationStats = {
    column: string | null
    bins: ReturnType<typeof buildCalibrationBins>
    predictions: Float64Array
    warnings: string[]
    roles?: string[]
    roleCounts?: Record<string, number>
    bandsPending?: boolean
    refreshAfterFsrs?: boolean
}
export let rwkvCalibrationStats = writable<RwkvCalibrationStats | null>(null)
derived(
    [cids, searchLimit, calibration_samples, rwkvStatsGeneration, rwkvCalibrationRevision],
    ([$cids, $searchLimit, samples], set: (value: RwkvCalibrationStats | null) => void) => {
        set(null)
        if (!$cids || !samples) {
            return
        }

        if (sampleCount(samples) === 0) {
            set({ column: null, bins: [], predictions: new Float64Array(0), warnings: [] })
            return
        }

        return latestResult(set, async (signal) => {
            const text = await getReviewRetrievabilityPages(
                "rwkv",
                $cids,
                $searchLimit,
                samples.revlogIds,
                signal,
                true
            )
            const parsed = await runStatsTask("calibrationPredictions", [samples, text], signal)
            for (const warning of parsed.warnings) console.warn("Search Stats Extended:", warning)
            const stats = {
                column: parsed.column,
                bins: parsed.bins,
                predictions: parsed.predictions,
                warnings: parsed.warnings,
                roles: parsed.roles,
                roleCounts: parsed.roleCounts,
                refreshAfterFsrs: false,
            }
            if (!signal.aborted) set({ ...stats, bandsPending: true })
            const intervals = await runStatsTask(
                "calibrationBands",
                [samples, parsed.predictions],
                signal
            )
            return {
                ...stats,
                bins: withConfidenceIntervals(parsed.bins, intervals),
                bandsPending: false,
                refreshAfterFsrs: parsed.refreshAfterFsrs,
            }
        })
    }
).subscribe(rwkvCalibrationStats.set)

derived([rwkvCalibrationStats, fsrsCalibrationGeneration], ([$rwkv, $generation]) => {
    // A quiet no-op can still unblock missing RWKV data. Watching both results
    // handles either response order without reloading an unchanged FSRS graph.
    if (
        $rwkv?.refreshAfterFsrs &&
        $generation?.phase === "ready" &&
        $generation.generated === false
    ) {
        rwkvCalibrationRevision.update((revision) => revision + 1)
    }
}).subscribe(() => {})

export const calibrationComparison = writable<ReturnType<Tasks["comparison"]> | null>(null)
let comparisonInputs: [CalibrationSamples, Float64Array, Float64Array] | null = null
let cancelComparison: (() => void) | undefined
derived(
    [calibration_samples, fsrsCalibrationStats, rwkvCalibrationStats],
    ([samples, fsrs, rwkv]) => {
        if (
            samples &&
            fsrs &&
            rwkv &&
            comparisonInputs?.[0] === samples &&
            comparisonInputs[1] === fsrs.predictions &&
            comparisonInputs[2] === rwkv.predictions
        )
            return
        cancelComparison?.()
        cancelComparison = undefined
        comparisonInputs = null
        calibrationComparison.set(null)
        if (samples && fsrs && rwkv) {
            comparisonInputs = [samples, fsrs.predictions, rwkv.predictions]
            const inputs: typeof comparisonInputs = [
                samples,
                heldOutFsrsPredictions(fsrs),
                rwkv.predictions,
            ]
            cancelComparison = latestResult(calibrationComparison.set, (signal) =>
                runStatsTask("comparison", inputs, signal)
            )
        }
    }
).subscribe(() => {})
