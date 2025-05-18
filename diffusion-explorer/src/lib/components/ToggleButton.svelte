<script lang="ts">
    import { createEventDispatcher } from 'svelte';

    export let className: string = ''; // Additional class names
    export let value: boolean = false; // Bound to parent store
    export let disabled: boolean = false;
    export let icon: string | null = null; // URL to icon image
    export let label: string = '';
    export let activeLabel: string | null= null; // Label when active;

    const dispatch = createEventDispatcher();

    function handleClick() {
        if (!disabled) {
            value = !value; // Triggers binding update
            dispatch('toggle', value);
        }
    }
</script>

<style>
    .toggle-button {
        cursor: pointer;
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: center;
        border-radius: 5px;
        padding: 0 10px;
        gap: 5px;
        box-shadow: 0px 0px 2px rgba(0, 0, 0, 0.4);
    }

    .toggle-button p {
        font-family: Arial, Helvetica, sans-serif;
        font-weight: 500;
        user-select: none;
    }

    .toggle-button img {
        width: 24px;
        height: 24px;
    }

    .toggle-button.active {
        background-color: #E0ECFE;
        color: #2368B0;
    }

    .toggle-button.active:hover {
        background-color: #c1daff;
    }

    .toggle-button.inactive {
        background-color: #ffffff;
        color: #565656;
    }

    .toggle-button.inactive img {
        filter: grayscale(100%);
    }

    .toggle-button.inactive:hover {
        background-color: #f0f0f0;
    }

    .toggle-button.disabled {
        background-color: #f0f0f0;
        color: #b0b0b0;
        cursor: not-allowed;
    }

    .toggle-button.disabled img {
        filter: grayscale(100%);
        opacity: 0.3;
    }
</style>

<div
    class="toggle-button {value ? 'active' : 'inactive'} {disabled ? 'disabled' : ''} {className}"
    on:click={handleClick}
>
    {#if icon}
        <img src={icon} alt={label} />
    {/if}
    {#if activeLabel}
        <p>{value ? activeLabel : label}</p>
    {:else}
        <p>{label}</p>
    {/if}
</div>