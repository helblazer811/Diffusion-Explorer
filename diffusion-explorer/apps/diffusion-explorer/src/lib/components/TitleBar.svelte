
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
        padding: 0px 10px;
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
        padding: 10px 0;
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
    /* Hide github logo if less thatn 1200 screen size */
    @media (max-width: 1280px) {
        #github-logo{
            display: none;
        }
    }

    /* If the screen becomes less than 700 wide then change the flex direction */
    @media (max-width: 700px) {
        .title-container {
            height: auto;
        }

        .title-inner-container {
            flex-direction: column;
            width: 100%;
        }

        .sub-title {
            width: 100%;
            text-align: left;
        }
    }
</style>

<div class="title-container">
    <div class="title-inner-container">
        <div class="title">
            <p><b>Diffusion</b>Explorer</p>
        </div>
        <h1 class="sub-title"> 
            Learn about diffusion and flow  models with interactive visualization. 
        </h1>
    </div>
    <a href="https://github.com/helblazer811/Diffusion-Explorer" id="github-logo" target="_blank">
        <img src="{base}/github-logo.svg" alt="GitHub Logo"/>
    </a>
</div>