<script>
    import { onDestroy } from 'svelte';
    import { isPlaying, playbackSpeed, currentTime, numberOfSteps, isLooping } from '$lib/state';

    export let disabled = false; // Whether the button is disabled
    let interval;

    // Toggle manually
    function togglePlay() {
        if (disabled) {
            return; // Don't do anything if the button is disabled
        }
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
                let nextTime = $currentTime + 1 / $numberOfSteps;
                // If nextTime is greater than 1, loop back to 0
                if (nextTime > 1 && $isLooping) {
                    nextTime = 0;
                } else if(nextTime > 1 && !$isLooping ){
                    // console.log(nextTime);
                    togglePlay();
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

    svg.disabled {
        fill: #d3d3d3;
    }
</style>

<button on:click={togglePlay} aria-label="Play/Pause">
    {#if $isPlaying}
        <!-- Pause Icon -->
        <svg 
            class:disabled={disabled}
            viewBox="0 0 24 24"
        >
            <rect x="6" y="5" width="4" height="14" />
            <rect x="14" y="5" width="4" height="14" />
        </svg>
    {:else}
        <!-- Play Icon -->
        <svg 
            class:disabled={disabled}
            viewBox="0 0 24 24"
        >
            <polygon points="5,3 19,12 5,21" />
        </svg>
    {/if}
</button>
