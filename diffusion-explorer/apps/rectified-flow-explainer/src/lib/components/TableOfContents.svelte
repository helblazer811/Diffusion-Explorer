<script>
  import { onMount } from 'svelte';

  // Props
  export let title = 'Contents';
  export let includeH3 = true;

  // State
  let headings = [];
  let activeId = '';
  let isOpen = false;
  let isScrolling = false;

  onMount(() => {
    // Extract headings from the page (h1, h2, and optionally h3)
    const selector = includeH3 ? 'h1[id], h2[id], h3[id]' : 'h1[id], h2[id]';
    const elements = document.querySelectorAll(selector);
    headings = Array.from(elements).map(el => ({
      id: el.id,
      text: el.textContent,
      level: el.tagName.toLowerCase()
    }));

    // Initialize with first heading active
    if (headings.length > 0) {
      activeId = headings[0].id;
    }

    // Set up IntersectionObserver for active section tracking
    const observer = new IntersectionObserver(
      (entries) => {
        // Don't update during programmatic smooth scrolling
        if (isScrolling) return;

        // Find all currently visible headings
        const visibleEntries = entries.filter(entry => entry.isIntersecting);

        if (visibleEntries.length > 0) {
          // Sort by position and pick the topmost one
          visibleEntries.sort((a, b) => {
            return a.boundingClientRect.top - b.boundingClientRect.top;
          });
          activeId = visibleEntries[0].target.id;
        }
      },
      { rootMargin: '-20% 0% -60% 0%', threshold: 0 }
    );

    elements.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  });

  function scrollTo(id) {
    isScrolling = true;
    activeId = id;
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    isOpen = false;
    // Re-enable observer after scroll completes
    setTimeout(() => {
      isScrolling = false;
    }, 600);
  }

  function toggleMenu() {
    isOpen = !isOpen;
  }

  function closeMenu() {
    isOpen = false;
  }
</script>

<!-- Desktop Sidebar -->
<nav class="toc-sidebar" aria-label="Table of contents">
  <h4 class="toc-title">{title}</h4>
  <ul class="toc-list">
    {#each headings as heading}
      <li>
        <button
          class="toc-item"
          class:active={activeId === heading.id}
          class:h2={heading.level === 'h2'}
          class:h3={heading.level === 'h3'}
          on:click={() => scrollTo(heading.id)}
        >
          {heading.text}
        </button>
      </li>
    {/each}
  </ul>
  <a href="https://github.com" target="_blank" rel="noopener noreferrer" class="github-link">
    Link to Code
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
    </svg>
  </a>
</nav>

<!-- Mobile FAB -->
<button class="toc-fab" on:click={toggleMenu} aria-label="Open table of contents">
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="3" y1="6" x2="21" y2="6"></line>
    <line x1="3" y1="12" x2="21" y2="12"></line>
    <line x1="3" y1="18" x2="21" y2="18"></line>
  </svg>
</button>

<!-- Mobile Modal -->
{#if isOpen}
  <div class="toc-backdrop" on:click={closeMenu} on:keydown={(e) => e.key === 'Escape' && closeMenu()} role="button" tabindex="0" aria-label="Close menu"></div>
  <div class="toc-modal" role="dialog" aria-modal="true" aria-label="Table of contents">
    <div class="toc-modal-header">
      <h4>{title}</h4>
      <button class="toc-close" on:click={closeMenu} aria-label="Close">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
    <ul class="toc-modal-list">
      {#each headings as heading}
        <li>
          <button
            class="toc-modal-item"
            class:h2={heading.level === 'h2'}
            class:h3={heading.level === 'h3'}
            on:click={() => scrollTo(heading.id)}
          >
            {heading.text}
          </button>
        </li>
      {/each}
    </ul>
    <a href="https://github.com" target="_blank" rel="noopener noreferrer" class="github-link-mobile">
      Link to Code
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
      </svg>
    </a>
  </div>
{/if}

<style>
  /* Desktop Sidebar */
  .toc-sidebar {
    display: none;
  }

  @media (min-width: 1200px) {
    .toc-sidebar {
      display: block;
      position: fixed;
      left: calc(max(280px, (100vw - 900px) / 2) - 250px);
      top: 180px;
      width: 220px;
      max-height: calc(100vh - 200px);
      overflow-y: auto;
    }
  }

  .toc-title {
    font-size: 0.9rem;
    font-weight: 600;
    color: #555;
    margin: 0 0 0.75rem 0;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .toc-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .toc-list li {
    margin: 0;
  }

  .toc-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 0.3rem 0.75rem;
    border: none;
    background: transparent;
    color: #555;
    font-size: 0.9rem;
    cursor: pointer;
    border-left: 3px solid transparent;
    transition: all 0.15s ease;
  }

  .toc-item:hover {
    color: rgb(0, 100, 200);
    background: #f5f5f5;
  }

  .toc-item.active {
    color: rgb(0, 100, 200);
    background: #f0f7ff;
    border-left-color: rgb(0, 100, 200);
    font-weight: 500;
  }

  .toc-item.h2 {
    padding-left: 1.25rem;
    font-size: 0.875rem;
  }

  .toc-item.h3 {
    padding-left: 2rem;
    font-size: 0.85rem;
  }

  /* Mobile FAB */
  .toc-fab {
    display: none;
  }

  @media (max-width: 1199px) {
    .toc-fab {
      display: flex;
      align-items: center;
      justify-content: center;
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      border: none;
      background: rgb(0, 100, 200);
      color: white;
      cursor: pointer;
      z-index: 100;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }

    .toc-fab:hover {
      transform: scale(1.05);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }

    .toc-fab:active {
      transform: scale(0.95);
    }
  }

  /* Mobile Backdrop */
  .toc-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 101;
  }

  /* Mobile Modal */
  .toc-modal {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: white;
    border-radius: 16px 16px 0 0;
    z-index: 102;
    max-height: 70vh;
    overflow-y: auto;
    box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.15);
  }

  .toc-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid #e0e0e0;
    position: sticky;
    top: 0;
    background: white;
  }

  .toc-modal-header h4 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
    color: #333;
  }

  .toc-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border: none;
    background: #f0f0f0;
    border-radius: 50%;
    cursor: pointer;
    color: #555;
    transition: background 0.15s ease;
  }

  .toc-close:hover {
    background: #e0e0e0;
  }

  .toc-modal-list {
    list-style: none;
    padding: 0.5rem 0;
    margin: 0;
  }

  .toc-modal-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 0.875rem 1.25rem;
    border: none;
    background: transparent;
    color: #333;
    font-size: 1rem;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .toc-modal-item:hover {
    background: #f5f5f5;
  }

  .toc-modal-item.h2 {
    padding-left: 1.75rem;
    font-size: 0.975rem;
  }

  .toc-modal-item.h3 {
    padding-left: 2.5rem;
    font-size: 0.95rem;
    color: #555;
  }

  /* GitHub Link - Desktop */
  .github-link {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem 0.5rem 15px;
    margin-top: 0.5rem;
    color: #555;
    text-decoration: none;
    font-size: 0.9rem;
    border-top: 1px solid #e0e0e0;
    transition: color 0.15s ease;
  }

  .github-link:hover {
    color: rgb(0, 100, 200);
  }

  /* GitHub Link - Mobile */
  .github-link-mobile {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 1rem 1.25rem;
    margin-top: 0.5rem;
    color: #333;
    text-decoration: none;
    font-size: 1rem;
    border-top: 1px solid #e0e0e0;
    transition: background 0.15s ease;
  }

  .github-link-mobile:hover {
    background: #f5f5f5;
  }
</style>
