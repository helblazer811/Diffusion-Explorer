<script>
    import * as settings from '$lib/settings';
	import { trainingObjective, activePlotTypes } from '$lib/state';

	// Reactively compute the available options for current objective
	$: options = settings.trainingObjectiveToDisplayOptions[$trainingObjective]?.["Plot Types"] || [];

	let isOpen = false;

	function toggleOption(option) {
		// Create a new Set from the current value
		const next = new Set($activePlotTypes);
		if (next.has(option)) {
			next.delete(option);
		} else {
			next.add(option);
		}
		// Write updated array back to the store
		activePlotTypes.set(Array.from(next));
	}
</script>


<style>
	.dropdown {
		position: relative;
		/* display: inline-block; */
        max-width: 200px;
        min-width: 150px;
        margin-top: 6px;
        margin-right: 20px;
	}

    .dropdown-button {
        height: 100%;
        width: 100%;
        display: flex;
        flex-direction: column;
        justify-content: center;
     }

	.dropdown-content {
		display: block;
		position: absolute;
		background-color: white;
		border: 1px solid #ccc;
		box-shadow: 0px 8px 16px rgba(0,0,0,0.2);
		padding: 10px;
		z-index: 1;
        padding-right: 30px;
        width: 80%
	}

    .dropdown {
        width: 100%;
        -webkit-appearance: none;
        -moz-appearance: none;
        appearance: none;
        display: block;
        background: none;
        border: none;
        border-radius: 0;
        /* padding: 6px 0; */
        font-size: 18px;
        border-bottom: solid 1px #ccc;
        color: #333;
        outline: none;
        height: 40px;
        /* Change font family */
        font-family: var(--font-family);
    }

    /* Arrow */
    .dropdown::after {
        position: absolute;
        font-family: 'Material Icons';
        content: "arrow_drop_down";
        color: #999;
        font-weight: normal;
        font-style: normal;
        font-size: 24px;
        line-height: 1;
        letter-spacing: normal;
        text-transform: none;
        display: inline-block;
        white-space: nowrap;
        word-wrap: normal;
        direction: ltr;
        right: 0px;
        top: 6px;
        pointer-events: none;
        /* align-self: center;    */
        /* transform: translateY(-50%); Vertically center the arrow */
    }
</style>

<div class="dropdown">
	<div
		class="dropdown-button"
		role="button"
		tabindex="0"
		on:click={() => isOpen = !isOpen}
		on:keydown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				isOpen = !isOpen;
			}
		}}>
		{$activePlotTypes.length > 0 ? `${$activePlotTypes.length} selected` : 'Select options'}
	</div>

	{#if isOpen}
		<div class="dropdown-content">
			{#each options as option}
				<label>
					<input
						type="checkbox"
						checked={$activePlotTypes.includes(option)}
						on:change={() => toggleOption(option)} />
					{option}
				</label><br />
			{/each}
		</div>
	{/if}
</div>
