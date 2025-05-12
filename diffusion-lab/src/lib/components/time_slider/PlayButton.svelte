<script>
    import { onDestroy } from 'svelte';
    import { isPlaying, playbackSpeed, currentTime, UIState} from '$lib/state';

    let interval;

    // Toggle manually
    function togglePlay() {
        isPlaying.update(value => !value);
    }
    // If isPlaying is true then update currentTime until it reaches 1 based on playbackSpeed
    // If isPlaying is false then stop updating currentTime

    $ : if ($isPlaying) {
        // Always clear existing interval before creating a new one
        clearInterval(interval);
        interval = setInterval(() => {
            if ($isPlaying) {
                // Update currentTime based on playbackSpeed
                let nextTime = $currentTime + 1 / $UIState.numberOfSteps;
                // If nextTime is greater than 1, reset it to 1
                if (nextTime > 1) {
                    nextTime = 1;
                }
                // Update the curentTime state
                currentTime.update(() => nextTime);
            } else {
                clearInterval(interval);
            }
        }, 1000 / $playbackSpeed);
    }
    // Clear the interval when the component is destroyed
    onDestroy(() => {
        clearInterval(interval);
    });

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
</style>

<button on:click={togglePlay} aria-label="Play/Pause">
    {#if $isPlaying}
        <!-- Pause Icon -->
        <svg viewBox="0 0 24 24">
            <rect x="6" y="5" width="4" height="14" />
            <rect x="14" y="5" width="4" height="14" />
        </svg>
    {:else}
        <!-- Play Icon -->
        <svg viewBox="0 0 24 24">
            <polygon points="5,3 19,12 5,21" />
        </svg>
    {/if}
</button>
