
<script>
    import { base } from '$app/paths';
</script>

<style>
    .title-container {
        height: 70px;
        width: 100%;
        background-color: var(--dark-blue);
        display: flex;
        justify-content: center;
        align-items: center;
    }

    .title-inner-container {
        height: 100%;
        width: calc(var(--display-area-width) - 200px);
        display: flex;
        flex-direction: row;
    }

    .title {
        height: 100%;
        width: 50%;
        margin: 0;
        font-size: 2.8em;
        color: white;
        font-family: var(--font-family);
        vertical-align: middle;
        text-align: left;
        display: flex;
        align-items: center;
        position: relative;
    }

    .title p {
        font-weight: 200; /* Thin font */
        margin: 0;
    }

    .sub-title {
        /* width: var(--display-area-width); */
        /* margin: 0 auto; */
        margin: 0;
        width: 50%;
        font-size: 1.25em;
        color: white;
        font-family: var(--font-family);
        font-weight: 200; /* Thin font */
        /* Vertically align the text */
        display: flex;
        align-items: center;
        text-align: right;
    }

    #github-logo {
        display: flex;
        align-items: center;
        justify-content: center;
        margin-right: 10px;
        position: absolute;
        right: 0;
        color: white;
        font-size: 1.7em;
        text-decoration: none;
        font-family: var(--font-family);
        font-weight: 200; /* Thin font */
    }

    #github-logo:hover {
        text-decoration: underline;
    }

    #github-logo img {
        width: 30px;
        height: 30px;
        margin-right: 10px;
    }
</style>

<div class="title-container">
    <div class="title-inner-container">
        <div class="title">
            <p><b>Diffusion</b>Lab</p>
        </div>
        <h1 class="sub-title"> 
            Learn about diffusion and flow  models with interactive visualization. 
        </h1>
    </div>
    <a href="https://github.com/helblazer811/DiffusionLab" id="github-logo" target="_blank">
        <img src="{base}/github-logo.svg" alt="GitHub Logo"/>
        Code
    </a>
</div>