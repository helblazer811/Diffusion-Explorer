<script lang="ts">
    import TimeSlider from '$lib/components/time_slider/TimeSlider.svelte';
    import CFGDisplayArea from './CFGDisplayArea.svelte';
    import { createCFGStateHandlers } from '$lib/state/classifier_free_guidance/actions';
    import * as cfgState from '$lib/state/classifier_free_guidance/state';
    import { onMount, setContext } from 'svelte';
    import { get } from 'svelte/store';
    import { base } from '$app/paths';
    import * as settings from '$lib/settings';
    import { callSamplingWorkerThread } from '$lib/diffusion/workers/sampling_client';
    import 'katex/dist/katex.min.css';
    import katex from 'katex';

    setContext('pageState', cfgState);

    const { 
        isPlaying, 
        currentTime, 
        allTimeSamples, 
        trainingObjective, 
        datasetName, 
        numberOfSteps,
        distributionVisiblity, 
    } = cfgState;
    const state_handlers = createCFGStateHandlers(cfgState);

    let currentClass = 0; // Current class for conditional sampling

    // Holds the rendered KaTeX HTML
    const equationLatex = '\\hat{\\epsilon}_\\theta(x_t, t, \\mathrm{cond}) =' +
        '\\epsilon_\\theta(x_t, t, \\varnothing) ' + 
        '+ s \\left[ \\epsilon_\\theta(x_t, t, \\mathrm{cond}) - \\epsilon_\\theta(x_t, t, \\varnothing) \\right]';
    let equationHTML = '';

    /*
    * This function draws class-conditioned samples from the model.
    * It generates 200 samples from each of the three classes (0, 1, 2)
    * and returns the guidance metadata.
    */
    async function drawClassConditionedSamples() {
        const trainingObjectiveVal = get(trainingObjective) as string;
        const datasetNameVal = get(datasetName) as string;
        const numberOfStepsVal = get(numberOfSteps) as number;
        
        // Check that we're using Conditional Diffusion
        if (trainingObjectiveVal !== 'Conditional Diffusion') {
            console.error("drawClassConditionedSamples can only be used with Conditional Diffusion");
            return Promise.reject("Invalid training objective");
        }
        
        // Load the pretrained model path
        const modelPath = base + settings.pretrainedModelPaths[trainingObjectiveVal][datasetNameVal];
        const modelConfig = settings.trainingObjectiveToModelConfig[trainingObjectiveVal];
        
        // Create array with 200 samples for each class (0, 1, 2)
        const samplesPerClass = 200;
        const numClasses = 1;
        const totalSamples = samplesPerClass * numClasses;
        
        // Create class labels: [0,0,0,...,1,1,1,...,2,2,2,...]
        const classes: number[] = [];
        for (let classIdx = 0; classIdx < numClasses; classIdx++) {
            for (let i = 0; i < samplesPerClass; i++) {
                classes.push(classIdx);
            }
        }
        
        return new Promise((resolve, reject) => {
            callSamplingWorkerThread(
                modelPath,
                trainingObjectiveVal,
                modelConfig,
                totalSamples,
                numberOfStepsVal,
                settings.domainRange,
                settings.interfaceSettings.distributionWidth,
                settings.interfaceSettings.displayAreaWidth,
                // Callback for when the sampling is done
                (allSamples: any, guidance: any) => {
                    // if (guidance) {
                    //     console.log("Received guidance data:", guidance);
                    //     resolve({ allSamples, guidance, classes });
                    // } else {
                    //     console.error("No guidance data returned");
                    //     reject("No guidance data returned");
                    // }
                    console.log("Received guidance data:", guidance);
                    allTimeSamples.set(allSamples);
                    isPlaying.set(true);
                    currentTime.set(0);
                },
                { // Options object
                    cond: classes, // Pass the class labels for conditioning
                    guidanceScale: 5.0, // Use a guidance scale of 5.0
                    return_guidance: true // Request guidance information
                }
            );
        });
    }

    onMount(async () => {
        // Render the CFG equation using your pattern
        equationHTML = katex.renderToString(
            equationLatex,
            { throwOnError: false }
        );

        // Draw class-conditioned samples with guidance metadata
        try {
            const result = await drawClassConditionedSamples();
            console.log('Class-conditioned samples:', result);
            // You can now use result.allSamples, result.guidance, and result.classes
        } catch (error) {
            console.error('Error drawing class-conditioned samples:', error);
        }

        // // Load and initialize everything
        // await state_handlers.runTraining();
        await state_handlers.loadDatasets();
        // await state_handlers.handleDatasetChange();
        state_handlers.initializeDistributions();
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
    }

    .description {
        width: 100%;
        padding-left: 180px;
        padding-right: 180px;
        font-size: 24px;
        box-sizing: border-box;
        text-align: left;
        font-family: Helvetica, sans-serif;
        color: #333333;
    }

    .equation {
        margin-top: 20px;
        font-size: 1.3em;
        text-align: center;
    }

    html, body {
        background-color: white !important;
    }
</style>

<div class="container">
    <div class="description"> 
        <h1>Classifier-free Diffusion Guidance</h1>
        <p>
            Classifier free guidance (CFG) is a technique used in diffusion models to steer the generation process towards desired attributes without relying on an external classifier. 
        </p>

        <!-- Equation rendered with KaTeX -->
        <div class="equation">{@html equationHTML}</div>
    </div>

    <div class="main-area">
        <CFGDisplayArea/>
    </div>

    <TimeSlider/> 
    <div class="footer"></div>
</div>
