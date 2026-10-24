<script lang="ts">
    export let render: (svg: SVGElement) => void
    let svg: SVGElement | undefined
    $: if (svg) render(svg)
</script>

<svg bind:this={svg}></svg>
