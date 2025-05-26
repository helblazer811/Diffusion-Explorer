<script>
    import {onDestroy} from 'svelte'
    import {isLooping} from '$lib/state'
    import {base} from '$app/paths'


    function toggleLoop() {
        isLooping.update(value => !value);
    }

</script>

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
        /* color:#7b7b7b; */
    }

</style>

<button on:click={toggleLoop} aria-label="Loop">
    {#if $isLooping}
    <!--Looping Icon-->
        <img class="loop-button"src="{base}/loopiconOn.svg" alt="Loop Button"/>
    {:else}
        <img class="loop-button" src="{base}/loopiconOff.svg" alt="Loop Button"/>
    {/if}
</button>