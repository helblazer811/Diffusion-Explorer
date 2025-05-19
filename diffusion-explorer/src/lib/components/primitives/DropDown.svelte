<script lang="ts">
    export let options: string[];
    export let value: string;
    export let disabled: boolean = false;

</script>

<style>
    .dropdown {
        max-width: 200px;
        min-width: 150px;
        margin-right: 20px;
        font-family: Arial, Helvetica, sans-serif;
        font-weight: 500;
        user-select: none;
    }

    .dropdown .select {
        position: relative;
        border-radius: 5px;
        height: 40px;
        box-shadow: 0px 0px 2px rgba(0, 0, 0, 0.4);
        background-color: #ffffff;
        display: flex;
    }

    .dropdown .select:hover {
        background-color: #f0f0f0;
    }

    .dropdown select {
        width: 100%;
        color: #565656;
        -webkit-appearance: none;
        -moz-appearance: none;
        appearance: none;
        display: block;
        background: none;
        padding: 6px 0;
        padding-left: 10px;
        font-size: 16px;
        border: none;
    }

    /* Arrow */
    .dropdown .select::after {
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
        top: 8px;
        pointer-events: none;
    }

    /* Make a disabled state for the dropdown */
    .select.disabled {
        background-color: #f0f0f0;
        cursor: not-allowed;
    }
    .select.disabled select {
        color: #b0b0b0;
    }
    
</style>

<div class="dropdown">
    <div class="select {disabled ? 'disabled' : ''}">
        <select bind:value={value}>
            {#each options as option}
                <option value={option}>{option}</option>
            {/each}
        </select>
    </div>
</div>