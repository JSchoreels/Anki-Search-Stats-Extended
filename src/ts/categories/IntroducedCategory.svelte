<script lang="ts">
    import RevlogGraphContainer from "../RevlogGraphContainer.svelte"
    import BarScrollable from "../BarScrollable.svelte"
    import LineOrCandlestick from "../LineOrCandlestick.svelte"
    import TrendValue from "../TrendValue.svelte"
    import GraphCategory from "../GraphCategory.svelte"
    import Warning from "../Warning.svelte"
    import { i18n, i18n_pattern } from "../i18n"
    import { TREND_PERSISTENCE_KEYS } from "../trendPersistenceKeys"
    import { barDateLabeler, type BarChart, type BarDatum } from "../bar"
    import { binSize, scroll, searchLimit, revlogStats } from "../stores"
    import { emptyTrendSelectionState, type TrendSelectionState } from "../trend"
    import { today, easeBarChart } from "../revlogGraphs"
    import _ from "lodash"
    import { browserSearchCurrent } from "../search"

    const bins = 30
    $: limit = -1 - $searchLimit
    $: truncated = $searchLimit !== 0

    function barLabel(i: number) {
        return (i - today).toString()
    }

    $: introduced_bar = {
        row_colours: ["#13e0eb", "#0c8b91"],
        row_labels: [i18n("introduced"), i18n("re-introduced")],
        data: Array.from($revlogStats?.introduced_day_count ?? [])
            .map((v, i) => {
                const introduced = v ?? 0
                const reintroduced = $revlogStats?.reintroduced_day_count[i] ?? 0
                return {
                    values: [introduced - reintroduced, reintroduced],
                    label: barLabel(i),
                } satisfies BarDatum
            })
            .map((d, i) => d ?? { values: [0, 0], label: barLabel(i) }),
        tick_spacing: 5,
        columnLabeler: barDateLabeler,
    }

    $: forgotten_bar = {
        row_colours: ["#330900"],
        row_labels: [i18n("forgotten")],
        data: Array.from($revlogStats?.day_forgotten ?? []).map((v, i) => ({
            values: [v ?? 0],
            label: barLabel(i),
        })),
        tick_spacing: 5,
        columnLabeler: barDateLabeler,
    }

    let include_reintroduced = true
    let normalize_ease = false
    $: introduced_ease = include_reintroduced
        ? ($revlogStats?.day_initial_reintroduced_ease ?? [])
        : ($revlogStats?.day_initial_ease ?? [])
    type ActiveCardFilter = "all" | "young" | "mature"
    let active_card_filter: ActiveCardFilter = "all"
    let include_suspended_active_cards = false
    let activeCardsTrendSelection: TrendSelectionState = emptyTrendSelectionState()

    $: active_cards_base_by_day =
        active_card_filter === "young"
            ? ($revlogStats?.active_cards_young_by_day ?? [])
            : active_card_filter === "mature"
              ? ($revlogStats?.active_cards_mature_by_day ?? [])
              : ($revlogStats?.active_cards_all_by_day ?? [])

    $: active_cards_suspended_by_day =
        active_card_filter === "young"
            ? ($revlogStats?.suspended_active_cards_young_by_day ?? [])
            : active_card_filter === "mature"
              ? ($revlogStats?.suspended_active_cards_mature_by_day ?? [])
              : ($revlogStats?.suspended_active_cards_all_by_day ?? [])

    $: active_cards_by_day = Array.from(
        { length: Math.max(active_cards_base_by_day.length, active_cards_suspended_by_day.length) },
        (_, day) =>
            (active_cards_base_by_day[day] ?? 0) +
            (include_suspended_active_cards ? (active_cards_suspended_by_day[day] ?? 0) : 0)
    )

    const introducedSearch = (i: number, width: number) =>
        browserSearchCurrent(`introduced:${-i + 1} -introduced:${-(i + width) + 1}`)
</script>

<GraphCategory hidden_title={i18n("introduced")} config_name="introduced">
    <RevlogGraphContainer>
        <h1 slot="title">{i18n("active-cards-over-time")}</h1>
        <LineOrCandlestick
            slot="graph"
            data={active_cards_by_day}
            label={i18n("cards")}
            bind:trendSelection={activeCardsTrendSelection}
            trendPersistenceKey={TREND_PERSISTENCE_KEYS.introduced.activeCards}
        />
        <div>
            <label>
                <input type="radio" bind:group={active_card_filter} value="all" />
                {i18n("all")}
            </label>
            <label>
                <input type="radio" bind:group={active_card_filter} value="young" />
                {i18n("young")}
            </label>
            <label>
                <input type="radio" bind:group={active_card_filter} value="mature" />
                {i18n("mature")}
            </label>
            <label>
                <input type="checkbox" bind:checked={include_suspended_active_cards} />
                {i18n("include-suspended")}
            </label>
        </div>
        <p>{i18n("active-cards-over-time-help")}</p>
        <TrendValue
            trends={activeCardsTrendSelection.visibleTrends}
            trend={activeCardsTrendSelection.previewTrend}
            n={$binSize}
            info={{ pattern: i18n_pattern("active-cards-per-day"), absolute: true }}
            onRemoveTrend={activeCardsTrendSelection.removeTrend}
            onTogglePinTrend={activeCardsTrendSelection.togglePinTrend}
            onToggleTrendMode={activeCardsTrendSelection.toggleTrendMode}
            onUpdateTrendRange={activeCardsTrendSelection.updateTrendRange}
            dateAxis
        />
        {#if truncated}
            <Warning>
                {i18n("generic-truncated-warning")}
            </Warning>
        {/if}
    </RevlogGraphContainer>
    <RevlogGraphContainer>
        <h1 slot="title">{i18n("introduced")}</h1>
        <BarScrollable
            slot="graph"
            data={introduced_bar}
            {bins}
            bind:binSize={$binSize}
            bind:offset={$scroll}
            {limit}
            search={introducedSearch}
        />
        <p>
            {i18n("introduced-help")}
        </p>
        {#if truncated}
            <Warning>
                {i18n("generic-truncated-warning")}
            </Warning>
        {/if}
    </RevlogGraphContainer>
    <RevlogGraphContainer>
        <h1 slot="title">{i18n("forgotten")}</h1>
        <BarScrollable
            slot="graph"
            data={forgotten_bar}
            {bins}
            bind:binSize={$binSize}
            bind:offset={$scroll}
            {limit}
        />
        <span>
            {i18n("forgotten-cards-not-yet-reintroduced", {
                number: ($revlogStats?.remaining_forgotten ?? 0).toLocaleString(),
            })}
        </span>

        <p>{i18n("forgotten-help")}</p>
        {#if truncated}
            <Warning>{i18n("forgotten-truncated-warning")}</Warning>
        {/if}
    </RevlogGraphContainer>
    <RevlogGraphContainer>
        <h1 slot="title">{i18n("introductory-rating")}</h1>
        <BarScrollable
            slot="graph"
            data={easeBarChart(introduced_ease, today, normalize_ease, barDateLabeler)}
            bind:binSize={$binSize}
            bind:offset={$scroll}
            average={normalize_ease}
            trend={normalize_ease}
            trend_date_axis
            trendPersistenceKey={TREND_PERSISTENCE_KEYS.introduced.introductoryRating}
            trend_by={(values: number[]) => (_.sum(values) == 0 ? 0 : 1 - values[3])}
            trend_info={{ pattern: i18n_pattern("retention-per-day"), percentage: true }}
            {limit}
            search={introducedSearch}
        />
        <label>
            <input type="checkbox" bind:checked={include_reintroduced} />
            {i18n("include-re-introduced")}
        </label>
        <label>
            <input type="checkbox" bind:checked={normalize_ease} />
            {i18n("as-ratio")}
        </label>
        <p>{i18n("introductory-rating-help")}</p>
    </RevlogGraphContainer>
</GraphCategory>
