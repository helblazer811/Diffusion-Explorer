<script lang="ts">
    import TimeSlider from '$lib/components/time_slider/TimeSlider.svelte';
    import CFGDisplayArea from './CFGDisplayArea.svelte';
    
    import { createCFGStateHandlers } from '$lib/state/classifier_free_guidance/actions';
    import * as cfgState from '$lib/state/classifier_free_guidance/state';
    import { onMount, onDestroy, setContext } from 'svelte';
    // Load up the application config
    // Load up the components
 
    // import Explanation from '$lib/components/Explanation.svelte';

    // Set context for child components
    setContext('pageState', cfgState);

    const { isPlaying, currentTime, allTimeGridSamples } = cfgState;
    const state_handlers = createCFGStateHandlers(cfgState);

    // Hard coded train loop 
    async function trainModel() {
        // Load the model
        // const model = await state_handlers.loadModel();
        // Start training
        // await state_handlers.trainModel(model);
    }

    onMount(async () => {
        // Load the datasets from the backend
        await state_handlers.loadDatasets();
        // Handle dataset change
        await state_handlers.handleDatasetChange();
        // Initialize the distributions 
        state_handlers.initializeDistributions()
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

    @media (max-width: 1100px) {
        .main-area {
            height: auto;
            padding-top: 20px;
        }
    }

    .footer {
        height: 10px;
        position: relative;
        box-shadow: 0 -2px 4px rgba(0, 0, 0, 0.2); /* upward shadow */
    }

</style>

<div class="container">
    <div class="main-area">
        <!-- <DatasetMenu datasetDict={datasetDict}/> -->
        <CFGDisplayArea allTimeGridSamples={$allTimeGridSamples} />
        <!-- </div> -->
    </div>
    <TimeSlider currentTime={currentTime} /> 
    <div class="footer"></div>
</div>