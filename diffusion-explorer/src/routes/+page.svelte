<script lang="ts">
    import * as state_management from '$lib/state_management';
    import { onMount, onDestroy} from 'svelte';
    // Load up the application config
    import { 
        targetDistributionSamples,
        isPlaying,
        datasetName,
        trainingObjective,
        isTraining,
        distributionVisiblity,
        cachedModelPaths,
        isEditing,
        usePretrained,
    } from '$lib/state';
    // Load up the components
    import TitleBar from '$lib/components/TitleBar.svelte';
    import TimeSlider from '$lib/components/time_slider/TimeSlider.svelte';
    import ControlBar from '$lib/components/control_bar/ControlBar.svelte';
    import DisplayArea from '$lib/components/display_area/DisplayArea.svelte';
    // import Explanation from '$lib/components/Explanation.svelte';

    let trainingWorker: Worker; // Variable to hold the training worker

    function handleKeydown(event: KeyboardEvent) {
        if (event.code === 'Space') {
            event.preventDefault(); // Prevent page scrolling
            // Toggle the play/pause state
            isPlaying.update(state => !state);
        }
    }

    function setupKeyboardInteractions() {
        // Add a listener to the window to handle keydown events
        window.addEventListener('keydown', handleKeydown);
    }

    onMount(async () => {
        // Load the datasets from the backend
        await state_management.loadDatasets()
        // Set up keyboard interactions
        setupKeyboardInteractions();
        // Initialize the distributions 
        state_management.initializeDistributions()
    });

    onDestroy(() => {
        if (typeof window !== 'undefined') {
            window.removeEventListener('keydown', handleKeydown);
        }
    });

    // Check if the dataset name is set to "brush" and if so, toggle off usePretrained
    $: if ($datasetName === "brush") {
        usePretrained.set(false);
    }

    // Add a handler for when training is running
    let trainingInitiated = false;
    $ : if ($isTraining && !trainingInitiated) {
        trainingInitiated = true;
        trainingWorker = state_management.startTraining();
    }
    // If training stopped, then stop the training thread
    // Becuase it is stopped by default, we need to check if training was ever initiated by the user
    $: if (!$isTraining && trainingInitiated && trainingWorker) {
        trainingInitiated = false;
        state_management.stopTraining(trainingWorker);
    }

    // Handle the editing model logic
    let editingInitiated = false;
    $ : if ($isEditing && !editingInitiated) {
        editingInitiated = true;
        state_management.startEditing(); 
    }

    // Switch to a non-pretrained model if usePretrained is set false, or back to pretrained if set true
    let lastPretrainedState = true;
    $ : if ($usePretrained && !lastPretrainedState && $datasetName !== "brush") { 
        lastPretrainedState = true;
        // Switch to using a pretrained model (if it exists)
    } else if (!$usePretrained && lastPretrainedState && $datasetName !== "brush") {
        lastPretrainedState = false;
        // Switch to using a non-pretrained model
        // If the model does not exist, then create a random model, save it, and run sampling with it
        // Check if the model exists
        if ($cachedModelPaths[$trainingObjective] && $cachedModelPaths[$trainingObjective][$datasetName]) {
            console.log("Found cached non-pretrained model. Loading it...");
        } else {
            // No model is found, so initialize a new one, save it, and run sampling with it
            console.error(`No  model found for ${$trainingObjective} on ${$datasetName}`);
        }
    }

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
    <TitleBar/>
    <ControlBar/>
    <div class="main-area">
        <!-- <DatasetMenu datasetDict={datasetDict}/> -->
        <DisplayArea/>
        <!-- </div> -->
    </div>
    <TimeSlider /> 
    <div class="footer"></div>
</div>