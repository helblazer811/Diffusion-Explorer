<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    children: Snippet;
    width?: number;
    gap?: number;
  }

  let { children, width = 260, gap = 24 }: Props = $props();
</script>

<div class="sidebar-anchor">
  <aside
    class="sidebar"
    style="--sidebar-width: {width}px; --sidebar-gap: {gap}px;"
  >
    <hr class="sidebar-rule sidebar-rule-top" />
    <div class="sidebar-content">{@render children()}</div>
    <hr class="sidebar-rule sidebar-rule-bottom" />
  </aside>
</div>

<style>
  .sidebar-anchor {
    position: relative;
    width: 100%;
    height: 0;
  }

  .sidebar {
    position: absolute;
    top: 0;
    left: 100%;
    width: var(--sidebar-width);
    margin-left: var(--sidebar-gap);
    font-size: 1rem;
    line-height: 1.4;
    color: var(--muted-color);
  }

  .sidebar-content :global(p) {
    font-size: inherit;
    line-height: inherit;
    margin: 0;
  }

  .sidebar-rule {
    border: none;
    border-top: 1px solid var(--divider-color);
    margin: 0 0 0.75rem 0;
  }

  .sidebar-rule-bottom {
    display: none;
    margin: 0.75rem 0 0 0;
  }

  .sidebar-content :global(> *:first-child) {
    margin-top: 0;
  }
  .sidebar-content :global(> *:last-child) {
    margin-bottom: 0;
  }

  @media (max-width: 768px) {
    .sidebar-anchor {
      height: auto;
    }
    .sidebar {
      position: static;
      width: 100%;
      margin: 1.5rem 0;
    }
    .sidebar-rule-bottom {
      display: block;
    }
  }
</style>
