<script lang="ts">
    import * as actions from '$lib/state/main/actions';
    import { onMount, onDestroy} from 'svelte';
    // Load up the application config
    import {
        isPlaying,
        datasetName,
        trainingObjective,
        isTraining,
        cachedModelPaths,
        isEditing,
        usePretrained,
        datasetDict,
    } from '$lib/state/main/state';
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

    // Check if the dataset name is set to "brush" and if so, toggle off usePretrained
    $: if ($datasetName === "brush") {
        usePretrained.set(false);
    } else {
        // If the dataset name is not "brush", set usePretrained to true by default
        // NOTE: this still allows switching to a non-pretrained model if the $datasetName is already active
        usePretrained.set(true);
    }

    // Add a handler for when training is running
    let trainingInitiated = false;
    $ : if ($isTraining && !trainingInitiated) {
        trainingInitiated = true;
        // If is editing then turn editing off
        if ($isEditing) {
            isEditing.set(false);
        }
        trainingWorker = actions.startTraining();
    }
    // If training stopped, then stop the training thread
    // Becuase it is stopped by default, we need to check if training was ever initiated by the user
    $: if (!$isTraining && trainingInitiated && trainingWorker) {
        trainingInitiated = false;
        actions.stopTraining(trainingWorker);
    }

    // Handle the editing model logic
    let editingInitiated = false;
    $ : if ($isEditing && !editingInitiated) {
        editingInitiated = true;
        actions.startEditing(); 
    }

    // If editing stopped, handle hiding the UI
    $ : if (!$isEditing && editingInitiated) {
        editingInitiated = false;
        actions.stopEditing();
    }

    // Handle dataset name change 
    $: if ($datasetName && $datasetDict[$datasetName] && typeof window !== 'undefined') { 
        // typof window ... makes sure this is not run on the server
        actions.handleDatasetChange();
    }

    // Handle usePretrained change
    $ : if ($usePretrained && $datasetDict[$datasetName] && typeof window !== 'undefined') {
        // Jut start training the model 
        actions.handleUsePretrained();
    }

    // Handle usePretrained is turned off
    $ : if (!$usePretrained && $datasetDict[$datasetName] && typeof window !== 'undefined') {
        // Just start training the model 
        isTraining.set(true);
    }

    // Handle training objective change
    $ : if ($trainingObjective && typeof window !== 'undefined') {
        // Just start training the model 
        actions.handleTrainingObjectiveChange();
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