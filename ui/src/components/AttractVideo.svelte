<script>
  export let videoSrc = '';
  export let playing = false;

  let videoEl;

  $: if (videoEl) {
    if (playing) {
      videoEl.play().catch(() => {});
    } else {
      videoEl.pause();
    }
  }
</script>

{#if videoSrc}
  <video
    bind:this={videoEl}
    src={videoSrc}
    class="attract-video"
    muted
    loop
    playsinline
    disableRemotePlayback
  />
{/if}

<style>
  .attract-video {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    object-fit: cover;
    z-index: 0;
  }
</style>
