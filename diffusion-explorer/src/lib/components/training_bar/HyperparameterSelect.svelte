<script lang="ts">
    export let name: string;
    export let options: string[];
    export let current: string;

</script>

<style>
    .control {
        flex-grow: 1;
        max-width: 200px;
        min-width: 150px;
        margin-top: 6px;
        margin-right: 20px;
    }

    .control label {
        color: #777;
        font-size: 18px;
        display: block;
        margin-bottom: 12px;
        font-weight: 300;
        font-family: var(--font-family);
    }
    /* 
    .control .value {
        font-size: 24px;
        margin: 0;
        font-weight: 300;
    }
    */
    .control .select {
        position: relative;
    }

    .control select {
        width: 100%;
        -webkit-appearance: none;
        -moz-appearance: none;
        appearance: none;
        display: block;
        background: none;
        border: none;
        border-radius: 0;
        padding: 6px 0;
        font-size: 18px;
        border-bottom: solid 1px #ccc;
        color: #333;
        outline: none;
        height: 40px;
        /* margin-right: 30px; */
        /* padding-right: 30px; make space for arrow */
    }

    .control select:focus {
        border-bottom-color: #183D4E;
    }

    /* Arrow */
    .control .select::after {
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

<div class="control">
    <label for={name}>{name}</label>
    <div class="select">
        <select id={name} bind:value={current}>
            {#each options as option}
                <option value={option}>{option}</option>
            {/each}
        </select>
    </div>
</div>