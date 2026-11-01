<script lang="ts">
    import DailyLineGraph from "./DailyLineGraph.svelte"
    import { calcTimePerReview } from "./dayTimings"
    import type { AveragingMode } from "./dailyMovingAverage"
    import { i18n, i18n_pattern } from "./i18n"
    import type { GraphsResponse_ReviewCountsAndTimes } from "./proto/anki/stats_pb"
    import { today } from "./revlogGraphs"
    import { searchLimit } from "./stores"
    import { TREND_PERSISTENCE_KEYS } from "./trendPersistenceKeys"

    export let data: GraphsResponse_ReviewCountsAndTimes | undefined

    const modes: Exclude<AveragingMode, "reviews">[] = ["calendar", "study"]
    $: daily = data ? calcTimePerReview(data) : []
    $: timeSpent = data
        ? Array.from({ length: Math.max(daily.length, today + 1) }, (_, day) => daily[day] ?? NaN)
        : []
    $: firstDay = timeSpent.findIndex(Number.isFinite)
    $: dayRange =
        firstDay < 0
            ? undefined
            : {
                  start: Math.max(firstDay, $searchLimit ? today - $searchLimit + 1 : firstDay),
                  end: today,
              }
</script>

{#if data}
    <DailyLineGraph
        data={timeSpent}
        label={i18n("seconds-per-review")}
        color="#fcba03"
        {dayRange}
        {modes}
        trendPersistenceKey={TREND_PERSISTENCE_KEYS.misc.reviewSpeedTrend}
        trendInfo={{ pattern: i18n_pattern("average-second-per-day") }}
    />
{:else}
    <p role="status">{i18n("loading")}</p>
{/if}
