<script>
  // @ts-nocheck
  import { onMount } from 'svelte';
  import { slide } from 'svelte/transition';

  export let expanded = false;
  export let title = "Click to expand/collapse";

  let contentHeight = 0;
  let contentElement;

  onMount(() => {
    if (contentElement) {
      contentHeight = contentElement.scrollHeight;
    }
  });

  function toggle() {
    expanded = !expanded;
  }
</script>

<div class="minimizable-container">
  <button
    class="toggle-button"
    on:click={toggle}
    aria-expanded={expanded}
    aria-label={title}
  >
    <span class="icon">{expanded ? '▼' : '▶'}</span>
    <span class="button-text">{title}</span>
  </button>

  {#if expanded}
    <div
      class="content"
      bind:this={contentElement}
      transition:slide={{ duration: 300 }}
    >
      <slot></slot>
    </div>
  {/if}
</div>

<style>
  .minimizable-container {
    border: 1px solid #ddd;
    border-radius: 4px;
    margin: 10px 0;
    /* margin-left: 80px; */
    overflow: hidden;
    width: 100%;
    /* max-width: 550px; */
  }

  .toggle-button {
    width: 100%;
    padding: 12px 16px;
    background: #f8f9fa;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    font-size: 16px;
    transition: background-color 0.2s;
  }

  .toggle-button:hover {
    background: #e9ecef;
  }

  .toggle-button:focus {
    outline: 2px solid #007bff;
    outline-offset: 2px;
  }

  .icon {
    margin-right: 8px;
    font-size: 14px;
    transition: transform 0.2s;
  }

  .button-text {
    flex: 1;
    text-align: left;
  }

  .content {
    padding: 16px;
    background: white;
  }
</style>
