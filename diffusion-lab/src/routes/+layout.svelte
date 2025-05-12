<!-- src/routes/+layout.svelte -->
<script>
    import '../app.css'; // Import global CSS variables and styles

</script>

<!-- Global layout wrapper (apply layout-wide structure or styles here) -->
<div class="layout-wrapper">
    <slot /> <!-- This renders your +page.svelte content here -->
</div>