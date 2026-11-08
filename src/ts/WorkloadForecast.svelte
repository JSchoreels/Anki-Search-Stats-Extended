<script lang="ts">
    import { onDestroy, onMount } from "svelte"
    import GraphContainer from "./GraphContainer.svelte"
    import GraphSvg from "./GraphSvg.svelte"
    import { i18n } from "./i18n"
    import { searchString } from "./stores"
    import {
        cancelWorkloadForecast,
        getWorkloadForecastAvailable,
        getWorkloadForecastProgress,
        startWorkloadForecast,
    } from "./search"
    import {
        buildForecastPoints,
        FORECAST_DAY_CHOICES,
        FORECAST_PATH_CHOICES,
        forecastProgressFraction,
        forecastTotalMean,
        type ForecastMetric,
        type WorkloadForecastProgress,
        type WorkloadForecastResult,
    } from "./workloadForecastData"
    import { renderWorkloadForecastGraph } from "./WorkloadForecastGraph"

    const metrics: ForecastMetric[] = ["due", "done", "new", "lapses", "minutes"]

    let available: boolean | null = null
    let days = 7
    let paths = 3
    let metric: ForecastMetric = "done"
    let running = false
    let progress: WorkloadForecastProgress | null = null
    let result: WorkloadForecastResult | null = null
    let error: string | null = null
    let jobId: number | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let generation = 0

    onMount(async () => {
        try {
            available = await getWorkloadForecastAvailable()
        } catch {
            available = false
        }
    })

    async function poll(id: number, current: number) {
        try {
            const next = await getWorkloadForecastProgress(id)
            if (current !== generation) return
            progress = next
            if (next.phase === "complete" && next.result) {
                result = next.result
                running = false
            } else if (next.phase === "failed" || next.phase === "missing") {
                error = next.error || i18n("workload-forecast-failed")
                running = false
            } else {
                timer = setTimeout(() => poll(id, current), 1000)
            }
        } catch {
            if (current !== generation) return
            error = i18n("workload-forecast-failed")
            running = false
        }
    }

    async function run() {
        const current = ++generation
        clearTimeout(timer)
        running = true
        error = null
        progress = null
        try {
            const started = await startWorkloadForecast({
                search: $searchString ?? "",
                days,
                paths,
            })
            if (current !== generation) return
            progress = started
            if (started.phase === "failed" || started.job_id === undefined) {
                error = started.error || i18n("workload-forecast-failed")
                running = false
                return
            }
            jobId = started.job_id
            if (started.phase === "complete" && started.result) {
                result = started.result
                running = false
            } else void poll(jobId, current)
        } catch {
            if (current === generation) {
                error = i18n("workload-forecast-failed")
                running = false
            }
        }
    }

    function cancel() {
        generation++
        clearTimeout(timer)
        running = false
        if (jobId !== null) void cancelWorkloadForecast(jobId).catch(() => {})
    }

    onDestroy(() => {
        generation++
        clearTimeout(timer)
        if (running && jobId !== null) void cancelWorkloadForecast(jobId).catch(() => {})
    })

    $: points = buildForecastPoints(result, metric)
    $: total = forecastTotalMean(points)
    $: percent = Math.round(forecastProgressFraction(progress) * 100)
</script>

{#if available}
    <GraphContainer graphId="fsrs:workload-forecast">
        <h1>{i18n("workload-forecast")}</h1>
        <div class="controls">
            <label>
                {i18n("workload-forecast-days")}
                <select bind:value={days} disabled={running}>
                    {#each FORECAST_DAY_CHOICES as choice}
                        <option value={choice}>{choice}</option>
                    {/each}
                </select>
            </label>
            <label>
                {i18n("workload-forecast-paths")}
                <select bind:value={paths} disabled={running}>
                    {#each FORECAST_PATH_CHOICES as choice}
                        <option value={choice}>
                            {choice === 3 ? i18n("workload-forecast-fast-option") : choice}
                        </option>
                    {/each}
                </select>
            </label>
            {#if running}
                <button on:click={cancel}>{i18n("workload-forecast-cancel")}</button>
            {:else}
                <button on:click={run}>
                    {i18n(result ? "workload-forecast-rerun" : "workload-forecast-run")}
                </button>
            {/if}
        </div>
        {#if running}
            <p>
                {i18n("workload-forecast-progress", {
                    current: progress?.current ?? 0,
                    total: progress?.total ?? paths,
                    percent,
                })}
            </p>
        {/if}
        {#if error}
            <p class="message">{error}</p>
        {/if}
        {#if result}
            <div class="controls" role="group" aria-label={i18n("workload-forecast-metric")}>
                {#each metrics as option}
                    <label>
                        <input type="radio" value={option} bind:group={metric} />
                        {i18n(`workload-forecast-metric-${option}`)}
                    </label>
                {/each}
            </div>
            {#key points}
                <GraphSvg render={(svg) => renderWorkloadForecastGraph(svg, points, metric)} />
            {/key}
            <p>
                {i18n(
                    result.paths === 3
                        ? "workload-forecast-fast-summary"
                        : "workload-forecast-summary",
                    {
                        total: Math.round(total),
                        paths: result.paths,
                        days: result.days,
                    }
                )}
            </p>
        {/if}
        <p>
            {i18n(
                result?.paths === 3 || (!result && paths === 3)
                    ? "workload-forecast-fast-help"
                    : "workload-forecast-help"
            )}
        </p>
        {#if result?.model === "instant"}
            <p>{i18n("workload-forecast-instant-help")}</p>
        {:else if result}
            <p>{i18n("workload-forecast-curve-help")}</p>
        {/if}
    </GraphContainer>
{:else if available === false}
    <GraphContainer graphId="fsrs:workload-forecast">
        <h1>{i18n("workload-forecast")}</h1>
        <p class="message">{i18n("workload-forecast-unavailable")}</p>
    </GraphContainer>
{/if}

<style>
    .controls {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 1rem;
        margin-bottom: 0.5rem;
    }
    .message {
        color: var(--fg-faint);
    }
</style>
