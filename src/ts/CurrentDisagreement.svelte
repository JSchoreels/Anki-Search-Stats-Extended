<script lang="ts">
    import { onDestroy } from "svelte"
    import GraphContainer from "./GraphContainer.svelte"
    import { cids } from "./stores"
    import { i18n } from "./i18n"
    import { getCurrentCardDisagreement } from "./search"
    import {
        buildCurrentDisagreementBins,
        type CurrentDisagreementResponse,
    } from "./currentDisagreementData"
    import { renderCurrentDisagreementGraph } from "./CurrentDisagreementGraph"

    let svg: SVGElement | undefined
    let response: CurrentDisagreementResponse | null = null
    let generation = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    async function load(ids: number[], current: number) {
        try {
            const result = await getCurrentCardDisagreement(ids)
            if (current !== generation) return
            response = result
            if (result.status === "pending") timer = setTimeout(() => load(ids, current), 1000)
        } catch {
            if (current === generation) response = { rows: [], total: ids.length, status: "failed" }
        }
    }

    function restart(ids: number[] | null) {
        const current = ++generation
        clearTimeout(timer)
        response = null
        if (ids) void load(ids, current)
    }
    $: restart($cids)
    $: bins = buildCurrentDisagreementBins(response?.rows ?? [])
    $: paired = bins.reduce((sum, bin) => sum + bin.cids.length, 0)
    $: if (svg) renderCurrentDisagreementGraph(svg, bins)
    onDestroy(() => {
        generation++
        clearTimeout(timer)
    })
</script>

<GraphContainer>
    <h1>{i18n("current-disagreement")}</h1>
    {#if !response || response.status === "pending"}
        <p>{i18n("loading")}</p>
    {:else if response.status !== "ready"}
        <p>{i18n(`current-disagreement-${response.status}`)}</p>
        <button on:click={() => restart($cids)}>
            {i18n("current-disagreement-retry")}
        </button>
    {:else if paired}
        <svg bind:this={svg}></svg>
    {:else}
        <p>{i18n("current-disagreement-no-data")}</p>
    {/if}
    {#if response?.status === "ready"}
        <p>{i18n("current-disagreement-count", { count: paired, total: response.total })}</p>
    {/if}
    <p>{i18n("current-disagreement-help")}</p>
</GraphContainer>
