<script>
    import { onDestroy } from "svelte";
    import { isLooping } from "$lib/state";
    import { base } from "$app/paths";

    function toggleLoop() {
        isLooping.update((value) => !value);
    }
</script>

<button on:click={toggleLoop} aria-label="Loop">
    {#if $isLooping}
        <!--Looping Icon-->
        <svg
            class="loop-button"
            aria-label="Loop Button"
            width="800px"
            height="800px"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
        >
            <path
                d="M3.5 13L3.29592 12.0476C2.62895 8.93509 5.00172 6 8.18494 6H19M19 6L16 9M19 6L16 3M20.5 11L20.7041 11.9524C21.3711 15.0649 18.9983 18 15.8151 18H5M5 18L8 15M5 18L8 21"
                stroke="#000000"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
            />
        </svg>
    {:else}
        <svg
            class="loop-button"
            aria-label="Loop Button"
            width="656"
            height="668"
            viewBox="0 0 656 668"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
        >
            <path
                d="M44.6667 367.333L37.864 335.587C15.6317 231.836 94.724 134 200.831 134H561.333M561.333 134L461.333 234M561.333 134L461.333 34M611.333 300.667L618.137 332.413C640.37 436.163 561.277 534 455.17 534H94.6667M94.6667 534L194.667 434M94.6667 534L194.667 634"
                stroke="#A6A1A1"
                stroke-width="66.6667"
                stroke-linecap="round"
                stroke-linejoin="round"
            />
        </svg>
    {/if}
</button>

<style>
    button {
        background: none;
        border: none;
        cursor: pointer;
        width: 40px;
        height: 40px;
    }
    svg {
        width: 100%;
        height: 100%;
        fill: #7b7b7b;
    }
    .loop-button {
        height: 40px;
        width: 40px;
    }
</style>
