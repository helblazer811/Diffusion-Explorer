<script>
  import { getContext } from 'svelte';

  let { indent = false, children } = $props();

  // Get the line counter from Algorithm context
  const counter = getContext('algorithm-line-counter');

  // Increment and capture line number on creation
  counter.value++;
  const lineNumber = counter.value;
</script>

<div class="algorithm-line" class:indented={indent}>
  <span class="line-number">{lineNumber}:</span>
  <span>{@render children?.()}</span>
</div>
