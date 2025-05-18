<script lang="ts">
    export let options: string[];
    export let value: string;

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
        /* border-bottom: solid 1px #ccc; */
        /* color: #333; */
        /* height: 40px; */
        /* margin-right: 30px; */
        /* padding-right: 30px; make space for arrow */
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
    
</style>

<div class="dropdown">
    <div class="select">
        <select bind:value={value}>
            {#each options as option}
                <option value={option}>{option}</option>
            {/each}
        </select>
    </div>
</div>