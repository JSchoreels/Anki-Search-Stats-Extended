<script lang="ts">
    import { i18n, i18n_bundle } from "./i18n"
    import { dayFromDateString, dayFromMs, dayToDateString } from "./revlogGraphs"
    import {
        compareTrendsByStart,
        trendPatternBySlope,
        type DrawnTrend,
        type TrendLine,
        type TrendInfo,
        type TrendRange,
    } from "./trend"

    export let trend: TrendLine = undefined
    export let trends: DrawnTrend[] = []
    export let n: number = 1

    export let info: TrendInfo = {}
    export let onRemoveTrend: ((id: number) => void) | undefined = undefined
    export let onTogglePinTrend: ((id: number) => void) | undefined = undefined
    export let onToggleTrendMode: ((id: number) => void) | undefined = undefined
    export let onUpdateTrendRange: ((id: number, range: TrendRange) => void) | undefined = undefined
    export let dateAxis = false

    let trendDateDrafts: Record<number, { start: string; end: string }> = {}

    $: ({
        pattern = "",
        positivePattern = undefined,
        negativePattern = undefined,
        percentage = false,
        absolute = false,
    } = info)

    function valueFromTrend(trend: TrendLine) {
        if (trend === undefined) {
            return 0
        }
        let trend_value = (trend.calcY(n) - trend.yStart) * (percentage ? 100 : 1)
        if (absolute) {
            trend_value = Math.abs(trend_value)
        }
        return trend_value
    }

    $: preview_value = valueFromTrend(trend)
    $: preview_pattern = trendPatternBySlope(trend, { pattern, positivePattern, negativePattern })
    $: trend_values = [...trends].sort(compareTrendsByStart).map((line) => ({
        ...line,
        value: valueFromTrend(line.trend),
        pattern: trendPatternBySlope(line.trend, { pattern, positivePattern, negativePattern }),
    }))

    function display(trend_value: number) {
        return (
            (trend_value > 1 ? trend_value.toFixed(2) : trend_value.toPrecision(2)) +
            (percentage ? "%" : "")
        )
    }

    function trendSummary(value: number, currentPattern: TrendInfo["pattern"]) {
        const nValue = i18n_bundle.formatPattern(currentPattern ?? "", { n, value: display(value) })
        if (n <= 1) {
            return nValue
        }
        const perDayValue = i18n_bundle.formatPattern(currentPattern ?? "", {
            n: 1,
            value: display(value / n),
        })
        return `${perDayValue} | ${nValue}`
    }

    function formatTrendDate(day: number, storedCoordinate: DrawnTrend["storedStartX"]) {
        if (
            typeof storedCoordinate === "string" &&
            storedCoordinate.trim().toLowerCase() === "today"
        ) {
            return "today"
        }
        return dayToDateString(day)
    }

    function trendDateDraft(line: DrawnTrend, field: "start" | "end") {
        const draft = trendDateDrafts[line.id]
        if (draft) {
            return draft[field]
        }
        return field === "start"
            ? formatTrendDate(line.startX, line.storedStartX)
            : formatTrendDate(line.endX, line.storedEndX)
    }

    function updateTrendDateDraft(lineId: number, field: "start" | "end", value: string) {
        trendDateDrafts = {
            ...trendDateDrafts,
            [lineId]: {
                start: trendDateDrafts[lineId]?.start ?? "",
                end: trendDateDrafts[lineId]?.end ?? "",
                [field]: value,
            },
        }
    }

    function parseTrendDateInput(value: string) {
        const normalized = value.trim()
        if (!normalized) {
            return
        }
        if (normalized.toLowerCase() === "today") {
            return { day: dayFromMs(Date.now()), storedCoordinate: "today" as const }
        }
        const day = dayFromDateString(normalized)
        if (day === undefined) {
            return
        }
        return { day, storedCoordinate: normalized }
    }

    function commitTrendDateDraft(line: DrawnTrend) {
        const draft = trendDateDrafts[line.id]
        if (!draft || !onUpdateTrendRange) {
            return
        }
        const start = parseTrendDateInput(draft.start || trendDateDraft(line, "start"))
        const end = parseTrendDateInput(draft.end || trendDateDraft(line, "end"))
        if (!start || !end) {
            const nextDrafts = { ...trendDateDrafts }
            delete nextDrafts[line.id]
            trendDateDrafts = nextDrafts
            return
        }
        onUpdateTrendRange(line.id, {
            startX: start.day,
            endX: end.day,
            storedStartX: start.storedCoordinate,
            storedEndX: end.storedCoordinate,
            mode: line.mode,
        })
        const nextDrafts = { ...trendDateDrafts }
        delete nextDrafts[line.id]
        trendDateDrafts = nextDrafts
    }
</script>

{#if trend !== undefined || trend_values.length}
    <br />
    <div class="trend-legend">
        {#if trend !== undefined}
            <div class="trend-item">
                <span class="swatch preview"></span>
                <span class="trend-text">
                    {i18n("trend-preview")}: {trendSummary(preview_value, preview_pattern)}
                </span>
            </div>
        {/if}
        {#each trend_values as line, i}
            <div class="trend-item">
                <span class="swatch" style:background={line.colour}></span>
                <span class="trend-text">
                    {i18n("trend")}
                    {i + 1}: {trendSummary(line.value, line.pattern)}
                </span>
                {#if dateAxis && onUpdateTrendRange}
                    <label class="trend-date">
                        <input
                            type="text"
                            value={trendDateDraft(line, "start")}
                            on:input={(event) =>
                                updateTrendDateDraft(
                                    line.id,
                                    "start",
                                    (event.currentTarget as HTMLInputElement).value
                                )}
                            on:change={() => commitTrendDateDraft(line)}
                        />
                        <span>to</span>
                        <input
                            type="text"
                            value={trendDateDraft(line, "end")}
                            on:input={(event) =>
                                updateTrendDateDraft(
                                    line.id,
                                    "end",
                                    (event.currentTarget as HTMLInputElement).value
                                )}
                            on:change={() => commitTrendDateDraft(line)}
                        />
                    </label>
                {/if}
                {#if onToggleTrendMode}
                    <button
                        type="button"
                        class="toggle-trend-mode"
                        aria-label={line.mode === "fitted"
                            ? "switch trend to endpoint line"
                            : "switch trend to fitted line"}
                        title={line.mode === "fitted"
                            ? "switch trend to endpoint line"
                            : "switch trend to fitted line"}
                        on:click={() => onToggleTrendMode?.(line.id)}
                    >
                        {line.mode === "fitted" ? "fit" : "ends"}
                    </button>
                {/if}
                {#if onTogglePinTrend}
                    <button
                        type="button"
                        class:active={line.pinned}
                        class="pin-trend"
                        aria-label={line.pinned ? "unpin trend" : "pin trend"}
                        title={line.pinned ? "unpin trend" : "pin trend"}
                        on:click={() => onTogglePinTrend?.(line.id)}
                    >
                        📌
                    </button>
                {/if}
                {#if onRemoveTrend}
                    <button
                        type="button"
                        class="remove-trend"
                        aria-label="remove trend"
                        on:click={() => onRemoveTrend?.(line.id)}
                    >
                        x
                    </button>
                {/if}
            </div>
        {/each}
    </div>
{/if}

<style>
    .trend-legend {
        display: grid;
        gap: 0.4em;
        margin-top: 0.3em;
    }

    .trend-item {
        display: flex;
        align-items: baseline;
        gap: 0.45em;
    }

    .swatch {
        width: 0.9em;
        height: 0.9em;
        border-radius: 3px;
        display: inline-block;
        border: 1px solid var(--text-faint);
    }

    .swatch.preview {
        background: repeating-linear-gradient(
            135deg,
            var(--text-faint),
            var(--text-faint) 3px,
            transparent 3px,
            transparent 6px
        );
    }

    .trend-text {
        overflow-wrap: anywhere;
    }

    .trend-date {
        display: inline-flex;
        align-items: center;
        gap: 0.35em;
        color: var(--text-faint);
        margin-left: 0.35em;
    }

    .trend-date input {
        width: 7.5em;
        min-width: 0;
    }

    .remove-trend {
        margin-left: 0.1em;
        border: none;
        background: transparent;
        color: var(--text-faint);
        line-height: 1;
        font-size: 0.95em;
        cursor: pointer;
        padding: 0 0.2em;
    }

    .remove-trend:hover {
        color: var(--text);
    }

    .toggle-trend-mode,
    .pin-trend {
        margin-left: 0.35em;
        border: none;
        background: transparent;
        color: var(--text-faint);
        line-height: 1;
        font-size: 0.95em;
        cursor: pointer;
        padding: 0 0.2em;
    }

    .toggle-trend-mode:hover,
    .pin-trend:hover {
        color: var(--text);
    }

    .pin-trend {
        margin-left: auto;
        opacity: 0.45;
        filter: grayscale(1);
    }

    .pin-trend.active {
        opacity: 1;
        filter: none;
    }
</style>
