<script>
    import { currentTime, isTraining, isEditing } from '$lib/state';
    import PlayButton from '$lib/components/time_slider/PlayButton.svelte';

    let disabled = false; // Whether the slider is disabled

    $ : if ($isTraining || $isEditing) {
        disabled = true; // Disable the slider if training is in progress
    } else {
        disabled = false; // Enable the slider if not training
    }

    let sliderStyle; 
    // Add dynamic background color based on the current time
    $: {
        const fillPercent = $currentTime * 100;
        sliderStyle = `background: linear-gradient(to right, #4594e3 ${fillPercent}%, #d3d3d3 ${fillPercent}%)`;
    }
</script>

<style>
    .time-slider-container {
        width: 100%;
        height: 100px;
        background-color: #ffffff;
        display: flex;
        justify-content: center;
    }

    .time-slider-inner-container {
        display: flex;
    }

    .time-slider {
        width: calc(var(--display-area-width) - var(--distribution-width) + 100px);
        height: 40px;
    }

    .slider {
        -webkit-appearance: none; /* Remove default styling */
        appearance: none;
        width: 100%;
        height: 5px;
        background: #4594e3;
        border-radius: 5px;
        outline: none;
    }

    /* Chrome, Safari, Edge */
    .slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 12px;
        height: 12px;
        background: #4594e3;
        border-radius: 50%;
        cursor: pointer;
    }

    /* Firefox */
    .slider::-moz-range-thumb {
        width: 12px;
        height: 12px;
        background: #4594e3;
        border-radius: 50%;
        cursor: pointer;
    }

    .disabled {
        pointer-events: none; /* Disable pointer events */
        opacity: 0.5; /* Make it look disabled */
    }

    .label-container {
        font-size: 1.3em;
        color:#2e2e2e;
        position: relative;
        width: 100%;
        /* height: 10px; */
        /* margin-top: 4x; */
    }

    .tick-container {
        position: relative;
        width: 100%;
        height: 20px;
        margin-top: 4px;
    }

    .tick {
        position: absolute;
        top: 0;
        width: 2px;
        height: 12px;
        background-color: #7b7b7b;
    }

    .tick-label {
        position: absolute;
        top: 15px;
        font-size: 1.2em;
        transform: translateX(-50%);
        font-family: Helvetica, sans-serif;
        color: #7b7b7b;
    }

    .play-button-container {
        /* position: absolute; */
        padding-right: 10px;
        left: 0;
        transform: translateY(-22%);
        z-index: 1;
        width: 40px; /* match padding */
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: auto; /* Ensure button is clickable */
    }

    /* If UI less than 900 then auto downscale the width of the time slider */
    @media (max-width: 900px) {
        .time-slider-inner-container {
            width: 80%;
        }
    }

</style>

<div class="time-slider-container">
    <div class="time-slider-inner-container">
        <div 
            class="play-button-container"
        >
            <PlayButton disabled={disabled}/>
        </div>
        <div 
            class="time-slider"
            class:disabled={disabled}
        >
            <input 
                type="range" 
                min="0" 
                max="1" 
                step="0.001"
                list="ticks"
                class="slider"
                style={sliderStyle}
                bind:value={$currentTime}
            />
            <div class="tick-container">
                <div class="tick" style="left: 1%;"></div>
                <div 
                    class="tick-label"
                    style="left: 1%;"
                >
                    t=0
                </div>
                <div class="tick" style="left: 99%;"></div>
                <div 
                    class="tick-label" 
                    style="left: 99%;"
                >
                    t=1
                </div>
            </div>
        </div>
    </div>
</div>