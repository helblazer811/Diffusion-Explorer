<script lang="ts">
    import * as actions from '$lib/state/classifier_free_guidance/actions';
    import { onMount, onDestroy} from 'svelte';
    // Load up the application config
    import {
        isPlaying,
        isTraining,
        isEditing,
    } from '$lib/state/main/state';
    // Load up the components
    import TimeSlider from '$lib/components/time_slider/TimeSlider.svelte';
    import DisplayArea from '$lib/components/display_area/DisplayArea.svelte';
    // import Explanation from '$lib/components/Explanation.svelte';

    function handleKeydown(event: KeyboardEvent) {
        if (event.code === 'Space') {
            event.preventDefault(); // Prevent page scrolling
            // Toggle the play/pause state
            if (!$isTraining && !$isEditing) {
                isPlaying.update(state => !state);
            }
        }
    }

    function setupKeyboardInteractions() {
        // Add a listener to the window to handle keydown events
        window.addEventListener('keydown', handleKeydown);
    }

    onMount(async () => {
        // Load the datasets from the backend
        await actions.loadDatasets()
        // Set up keyboard interactions
        setupKeyboardInteractions();
        // Initialize the distributions 
        actions.initializeDistributions()
    });

    onDestroy(() => {
        if (typeof window !== 'undefined') {
            window.removeEventListener('keydown', handleKeydown);
        }
    });

</script>

<style>
    .container {
        position: relative;
    }

    .main-area {
        width: 100%;
        height: var(--main-area-height);
        background-color: white;
        display: flex;
        justify-content: center;
        overflow: hidden;
        position: relative;
    }

    .footer {
        height: 10px;
        position: relative;
        box-shadow: 0 -2px 4px rgba(0, 0, 0, 0.2); /* upward shadow */
    }

    @media (max-width: 1100px) {
        .main-area {
            height: auto;
            padding-top: 20px;
        }
    }

</style>

<div class="container">
    <div class="main-area">
        <!-- <DatasetMenu datasetDict={datasetDict}/> -->
        <DisplayArea/>
        <!-- </div> -->
    </div>
    <TimeSlider /> 
    <div class="footer"></div>
</div>