<script>
  import { onMount, onDestroy } from 'svelte';
  import { tweened } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import Leaderboard from './components/Leaderboard.svelte';

  let st = 'waiting';
  let cr = 0;
  let rec = [850, 720, 500];
  let isNewRecord = false;
  let score_final = 0;
  let hidden = false;
  let showLeaderboard = true;
  let showScore = false;
  let showReady = false;
  let showResult = false;
  let showCountdown = false;
  let countdownNum = 3;
  let countdownTimer = null;
  let backendConnected = false;
  let barProgress = 0;
  let barAnimFrame = null;

  let transActive = false;
  let transType = '';
  let transCallback = null;
  let prevSt = 'waiting';
  let pendingState = null;
  let pendingWhy = null;

  const animatedScore = tweened(0, {
    duration: 1200,
    easing: cubicOut,
  });

  function getHitText(score) {
    if (score >= 801) return 'PERFECTO';
    if (score >= 601) return 'FUERTE';
    if (score >= 401) return 'MEDIO';
    if (score >= 201) return 'SUAVE';
    return 'DÉBIL';
  }

  function startBarFill() {
    barProgress = 0;
    if (barAnimFrame) cancelAnimationFrame(barAnimFrame);
    function step() {
      barProgress = Math.min(1, barProgress + 0.02);
      if (barProgress < 1) {
        barAnimFrame = requestAnimationFrame(step);
      }
    }
    barAnimFrame = requestAnimationFrame(step);
  }

  function stopBarFill() {
    if (barAnimFrame) { cancelAnimationFrame(barAnimFrame); barAnimFrame = null; }
  }

  function resetBarFill() {
    barProgress = 0;
  }

  function startCountdown() {
    showCountdown = true;
    showLeaderboard = false;
    showScore = false;
    showReady = false;
    showResult = false;
    countdownNum = 3;
    startBarFill();

    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      countdownNum -= 1;
      resetBarFill();
      startBarFill();
      if (countdownNum <= 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        barProgress = 1;
        stopBarFill();
      }
    }, 1000);
  }

  function getTransitionType(from, to) {
    if (from === 'ready' && (to === 'animating' || to === 'result')) return 'impact';
    if ((from === 'animating' || from === 'result') && (to === 'waiting' || to === 'attract')) return 'reset';
    return null;
  }

  function _applyState(newState, why) {
    st = newState;

    hidden = false;
    if (newState === 'countdown') {
      startCountdown();
      return;
    }

    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }

    if (newState === 'attract' || newState === 'waiting') {
      showLeaderboard = true;
      showScore = false;
      showReady = false;
      showResult = false;
      showCountdown = false;
    } else {
      showLeaderboard = false;
      showScore = newState === 'animating' || newState === 'result';
      showReady = newState === 'ready';
      showResult = newState === 'result';
      showCountdown = false;
    }
  }

  function flushPending() {
    if (pendingState) {
      const ns = pendingState;
      const nw = pendingWhy;
      pendingState = null;
      pendingWhy = null;
      _applyState(ns, nw);
    }
  }

  function applyState(newState, why) {
    if (transActive) {
      pendingState = newState;
      pendingWhy = why;
      return;
    }

    const tType = getTransitionType(prevSt, newState);
    prevSt = st;

    if (tType) {
      transActive = true;
      transType = tType;
      transCallback = () => {
        transActive = false;
        transType = '';
        transCallback = null;
        _applyState(newState, why);
        flushPending();
      };
    } else {
      _applyState(newState, why);
    }
  }

  applyState('waiting', 'init');

  function handleKey(e) {
    if (e.repeat) return;
    const key = e.key.toLowerCase();

    if (key === 'c' || key === 'm') {
      fetch('/api/coin', { method: 'POST' });
      return;
    }

    if (key === ' ') {
      e.preventDefault();
      if (st === 'waiting' && cr > 0) {
        fetch('/api/pera-abajo', { method: 'POST' });
      } else if (st === 'ready') {
        const fakeScore = Math.floor(Math.random() * 700) + 300;
        fetch('/api/punch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ score: fakeScore }),
        });
      }
      return;
    }
  }

  function cambiar_estado(data) {
    const newState = data.state;
    if (data.credits !== undefined) cr = data.credits;
    if (data.records) rec = data.records;
    if (newState === 'animating' && data.score !== undefined) {
      score_final = data.score;
      animatedScore.set(0, { duration: 0 });
      setTimeout(() => animatedScore.set(data.score), 50);
    }
    if (newState === 'result') {
      isNewRecord = !!data.newRecord;
    }
    if (!backendConnected) {
      backendConnected = true;
    }
    applyState(newState, 'ipc');
  }

  let eventSource = null;

  onMount(async () => {
    window.addEventListener('keydown', handleKey);

    eventSource = new EventSource('/api/events');
    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        cambiar_estado(data);
      } catch (x) {}
    };
    eventSource.onopen = () => {
      backendConnected = true;
    };

    try {
      const res = await fetch('/api/state');
      const state = await res.json();
      if (state) {
        backendConnected = true;
        cr = state.credits;
        rec = state.records;
        if (st !== state.state) {
          applyState(state.state, 'init');
        }
      }
    } catch (e) {}
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleKey);
    if (eventSource) eventSource.close();
  });

  $: animatingScore = $animatedScore;

  $: scoreRatio = Math.min(1, animatingScore / 999);
  $: glowScale = Math.min(2.2, 0.25 + scoreRatio * 1.95);
</script>

<div class="container">
  <!-- Recessed Neon Frame -->
  <div class="neon-frame"></div>

  <!-- View Transition Overlay -->
  <div
    class="trans-overlay"
    class:trans-impact={transType === 'impact'}
    class:trans-reset={transType === 'reset'}
    class:active={transActive}
    on:animationend={(e) => { if (transCallback) { const cb = transCallback; transCallback = null; cb(); } }}
  ></div>

  <!-- Industrial chamfered bars + Allen screws -->
  <div class="bar top"></div>
  <div class="bar bottom"></div>
  <div class="screw tl"></div>
  <div class="screw tr"></div>
  <div class="screw bl"></div>
  <div class="screw br"></div>

  <!-- Hydraulic pressure bars (left & right) -->
  <div class="side-bar left" class:active={showLeaderboard || showCountdown || showReady || showScore}>
    <div class="bar-fill" class:chase={showLeaderboard} class:pulse={showReady}
         style="height: {showLeaderboard ? 100 : showScore ? scoreRatio * 100 : barProgress * 100}%">
    </div>
  </div>
  <div class="side-bar right" class:active={showLeaderboard || showCountdown || showReady || showScore}>
    <div class="bar-fill" class:chase={showLeaderboard} class:pulse={showReady}
         style="height: {showLeaderboard ? 100 : showScore ? scoreRatio * 100 : barProgress * 100}%">
    </div>
  </div>

  <div class="overlay" class:hidden>
    <header class="header">
      <img
        src="/k11icon.webp"
        alt="K11"
        class="logo"
        on:error={() => {}} on:load={() => {}}
      />
      <h1 class="logo-fallback">K11</h1>
    </header>

    <main class="main" class:punch-active={showReady || showResult}>
      {#if showLeaderboard}
        <div class="leaderboard-wrapper">
          <Leaderboard records={rec} />
        </div>
      {/if}

      {#if showScore}
        {#key st}
          <div class="score-section" class:glitch={isNewRecord && showResult} class:flash={st === 'result'}>
            <span class="score-label">PUNCH POWER</span>
            <div class="score-number" class:counting={st === 'animating'} style="--glow: {glowScale}; --red: {scoreRatio}">
              {String(Math.round(animatingScore)).padStart(3, '0')}
            </div>
          </div>
        {/key}
      {/if}

      {#if showCountdown}
        <div class="countdown-section">
          {#key countdownNum}
            <span class="countdown-number">{countdownNum}</span>
          {/key}
          <span class="countdown-label">PREPARE</span>
        </div>
      {/if}

      {#if st === 'waiting' || st === 'attract'}
        <div class="status-area">
          {#if cr <= 0}
            <div class="credits-panel">
              {#key cr}
                <p class="status-value">0</p>
              {/key}
              <p class="status-label">CREDITS</p>
            </div>
            <div class="hazard-bar">
              <p class="status-prompt">INSERT COIN</p>
            </div>
          {:else}
            <div class="credits-panel active">
              {#key cr}
                <p class="status-value">{cr}</p>
              {/key}
              <p class="status-label">CREDITS</p>
            </div>
            <div class="hazard-bar active">
              <p class="status-prompt">PULSA EL BOTON</p>
            </div>
          {/if}
        </div>
      {/if}

      {#if showReady}
        <div class="status-area">
          <p class="punch-text">PUNCH!</p>
        </div>
      {/if}

      {#if showResult}
        <div class="status-area">
          {#if isNewRecord}
            <p class="new-record">NEW RECORD</p>
          {:else}
            <p class="good-hit">{getHitText(score_final)}</p>
          {/if}
        </div>
      {/if}
    </main>

    <footer class="footer">
      <div class="connection-dot" class:active={backendConnected} />
    </footer>
  </div>
</div>

<style>
  /* =============================
     FONT-FACE (official brand fonts)
  ============================= */
  @font-face {
    font-family: 'Atmospheric';
    src: url('/fonts/aAtmospheric.ttf') format('truetype');
    font-weight: normal;
    font-style: normal;
    font-display: block;
  }

  @font-face {
    font-family: 'Acumin Variable';
    src: url('/fonts/Acumin-Variable-Concept.woff2') format('woff2'),
         url('/fonts/Acumin-Variable-Concept.ttf') format('truetype');
    font-weight: 400 900;
    font-style: normal;
    font-display: block;
  }

  /* =============================
     ROOT - Black, solid, industrial
  ============================= */
  .container {
    width: 100vw;
    height: 100vh;
    background-color: #000000;
    box-sizing: border-box;
    border: none;
    box-shadow:
      inset 0 0 0 1px rgba(204, 5, 5, 0.4);
    overflow: hidden;
    position: relative;
  }

  /* =============================
     CHAMFERED BARS + ALLEN SCREWS
  ============================= */
  .bar {
    position: absolute;
    left: 0;
    right: 0;
    height: 7px;
    background: #ff3333;
    box-shadow: 0 0 8px rgba(204, 5, 5, 0.6);
    pointer-events: none;
    z-index: 10;
  }
  .bar.top {
    top: 0;
    clip-path: polygon(40px 0, calc(100% - 40px) 0, 100% 7px, 0 7px);
  }
  .bar.bottom {
    bottom: 0;
    clip-path: polygon(40px 100%, calc(100% - 40px) 100%, 100% calc(100% - 7px), 0 calc(100% - 7px));
  }

  .screw {
    position: absolute;
    z-index: 12;
    width: 16px;
    height: 16px;
    background: #2a2a2a;
    border: 2px solid #555;
    clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
    box-shadow: inset 0 0 6px #000000, 0 0 4px rgba(0,0,0,0.8);
    pointer-events: none;
  }
  .screw.tl { top: -3px; left: 12px; }
  .screw.tr { top: -3px; right: 12px; }
  .screw.bl { bottom: -3px; left: 12px; }
  .screw.br { bottom: -3px; right: 12px; }

  /* =============================
     HYDRAULIC PRESSURE BARS
  ============================= */
  .side-bar {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 12px;
    z-index: 5;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.3s;
  }
  .side-bar::before {
    content: '';
    position: absolute;
    inset: 0;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(204, 5, 5, 0.12);
    border-radius: 5px;
    pointer-events: none;
  }
  .side-bar.active { opacity: 1; }
  .side-bar.left { left: 6px; }
  .side-bar.right { right: 6px; }

  .bar-fill {
    position: absolute;
    bottom: 0;
    left: 1px;
    right: 1px;
    background: linear-gradient(to top, #ffffff 0%, #ff5555 20%, #cc0505 100%);
    border-radius: 3px 3px 0 0;
    box-shadow: 0 0 6px rgba(204, 5, 5, 0.5);
    transition: height 0.06s linear;
  }

  .bar-fill.pulse {
    animation: bar-pulse 0.4s ease-in-out infinite alternate;
  }

  .bar-fill.chase {
    background: repeating-linear-gradient(
      to top,
      #cc0505 0px,
      #cc0505 8px,
      #ff4444 8px,
      #ff4444 12px,
      #cc0505 12px,
      #cc0505 20px
    );
    box-shadow: 0 0 6px rgba(204, 5, 5, 0.6);
    background-size: 100% 40px;
    animation: led-chase 1s linear infinite;
  }

  @keyframes bar-pulse {
    0% { box-shadow: 0 0 6px rgba(204, 5, 5, 0.5); }
    100% { box-shadow: 0 0 12px rgba(204, 5, 5, 0.8); }
  }

  /* =============================
     LAYOUT
  ============================= */
  .overlay {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    position: relative;
    z-index: 1;
  }
  .overlay.hidden {
    display: none;
  }

  .header {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 24vh;
    min-height: 150px;
    padding-top: 2vh;
    position: relative;
  }
  .header::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 60vmin;
    height: 60vmin;
    transform: translate(-50%, -50%);
    background: radial-gradient(circle, rgba(255, 30, 30, 0.5) 0%, rgba(204, 5, 5, 0.2) 40%, transparent 70%);
    pointer-events: none;
  }

  .logo {
    display: block;
    height: 100%;
    max-height: 260px;
    width: auto;
    object-fit: contain;
    will-change: transform;
    animation: flicker-in 0.4s steps(1, start) forwards;
  }

  .logo-fallback { display: none; }

  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    gap: 2vh;
    padding-top: 1vh;
  }

  .leaderboard-wrapper {
    width: 100%;
    display: flex;
    justify-content: center;
    padding: 1vh 0;
    margin-top: 0;
  }

  /* =============================
     COUNTDOWN
  ============================= */
  .countdown-section {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5vh;
  }

  .countdown-number {
    font-family: 'Atmospheric';
    font-size: clamp(200px, 45vh, 550px);
    font-weight: 900;
    line-height: 1;
    color: #ffffff;
    text-shadow:
      4px 4px 0 #cc0505,
      8px 8px 0 #000000;
    transform: perspective(600px) rotateX(8deg) translateZ(0);
    animation: countdown-pop 0.8s ease-out both;
    will-change: transform;
  }

  .countdown-label {
    font-family: 'Acumin Variable';
    font-size: clamp(14px, 3vh, 28px);
    font-weight: 400;
    color: #ffffff;
    letter-spacing: 12px;
    text-transform: uppercase;
    animation:
      flicker-in 0.5s steps(1, start) forwards,
      fade-pulse 0.5s 0.5s steps(2, start) infinite;
  }

  @keyframes countdown-pop {
    0% { transform: scale(2.8); opacity: 0; }
    25% { transform: scale(0.92); opacity: 1; }
    65% { transform: scale(1.04); opacity: 1; }
    100% { transform: scale(1); opacity: 1; }
  }

  @keyframes fade-pulse {
    0%, 49% { opacity: 1; }
    50%, 100% { opacity: 0; }
  }

  @keyframes flicker-in {
    0% { opacity: 0; }
    20% { opacity: 0.6; }
    40% { opacity: 1; }
    100% { opacity: 1; }
  }

  /* =============================
     SCORE SECTION
  ============================= */
  .score-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    gap: 0.5vh;
  }
  .score-section.flash {
    animation: score-flash 0.9s ease-out forwards;
  }

  @keyframes score-flash {
    0% { opacity: 0.6; }
    18% { opacity: 0.6; }
    35% { opacity: 1; }
    100% { opacity: 1; }
  }

  .score-section.glitch .score-number {
    animation: score-glitch 1.2s ease-out forwards;
  }

  @keyframes score-glitch {
    0% { transform: perspective(600px) rotateX(8deg) translateZ(0); }
    10% { transform: perspective(600px) rotateX(8deg) translate(-3px,2px); }
    20% { transform: perspective(600px) rotateX(8deg) translate(3px,-1px); }
    30%,100% { transform: perspective(600px) rotateX(8deg) translateZ(0); }
  }

  .score-label {
    font-family: 'Acumin Variable';
    font-size: clamp(14px, 2.5vh, 24px);
    font-weight: 700;
    color: #cc0505;
    letter-spacing: 8px;
    text-transform: uppercase;
    border-top: 2px solid rgba(204, 5, 5, 0.3);
    border-bottom: 2px solid rgba(204, 5, 5, 0.3);
    padding: 0.6vh 3vw;
    animation: flicker-in 0.4s steps(1, start) forwards;
  }

  .score-number {
    font-family: 'Acumin Variable';
    font-size: clamp(100px, 20vh, 280px);
    font-weight: 900;
    line-height: 1;
    letter-spacing: 2px;
    max-width: 100vw;
    overflow: hidden;
    color: #ffffff;
    text-shadow:
      3px 3px 0 #cc0505,
      6px 6px 0 #000000;
    transform: perspective(600px) rotateX(8deg) translateZ(0);
    animation: flicker-in 0.35s steps(1, start) forwards;
    will-change: transform;
  }

  .score-number.counting {
    animation:
      flicker-in 0.35s steps(1, start) forwards,
      score-throb 0.08s infinite alternate;
  }

  @keyframes score-throb {
    0% { transform: perspective(600px) rotateX(8deg) scale(1); }
    100% { transform: perspective(600px) rotateX(8deg) scale(1.03); }
  }

  /* =============================
     STATUS - CREDITS PANEL + HAZARD BAR
  ============================= */
  .status-area {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2vh;
    min-height: 20vh;
    width: 100%;
    padding: 1vh 0 4vh;
  }

  .punch-active .status-area {
    flex: 1;
    min-height: 0;
    padding: 0;
  }

  .punch-active .score-section {
    flex: 0 0 auto;
  }

  .punch-active .countdown-section {
    flex: 1;
  }

  /* ----- Credits & prompt text only (no boxes) ----- */
  .credits-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4vh;
    animation: flicker-in 0.4s steps(1, start) forwards;
  }

  .status-value {
    font-family: 'Acumin Variable';
    font-size: clamp(52px, 11vh, 100px);
    font-weight: 900;
    line-height: 1;
    margin: 0;
    color: rgba(255, 255, 255, 0.25);
    text-shadow: 2px 2px 0 rgba(0,0,0,0.5);
    animation: flicker-in 0.4s steps(1, start) forwards;
  }

  .credits-panel.active .status-value {
    color: #cc0505;
    text-shadow:
      2px 2px 0 #cc0505,
      4px 4px 0 #000000;
  }

  .status-label {
    font-family: 'Acumin Variable';
    font-size: clamp(14px, 2.8vh, 24px);
    font-weight: 700;
    margin: 0;
    color: rgba(255, 255, 255, 0.5);
    letter-spacing: 8px;
    text-transform: uppercase;
  }

  .hazard-bar {
    text-align: center;
  }

  .status-prompt {
    font-family: 'Acumin Variable';
    font-size: clamp(18px, 3.5vh, 32px);
    font-weight: 900;
    margin: 0;
    color: #ffffff;
    letter-spacing: 10px;
    text-transform: uppercase;
    text-shadow:
      1px 1px 0 #000000,
      2px 2px 0 #000000;
    animation:
      flicker-in 0.5s steps(1, start) forwards,
      prompt-blink 1.2s 0.6s infinite;
  }

  .hazard-bar.active .status-prompt {
    text-shadow:
      0 0 4px #ffffff,
      0 0 10px #cc0505,
      0 0 25px #cc0505,
      1px 1px 0 #000000,
      2px 2px 0 #000000;
  }

  @keyframes prompt-blink {
    0%, 40% { opacity: 1; }
    45%, 55% { opacity: 0; }
    60%, 100% { opacity: 1; }
  }

  /* =============================
     PUNCH! / RESULT STATES
  ============================= */
  .punch-text {
    font-family: 'Atmospheric';
    font-size: clamp(48px, min(14vh, 16vw), 130px);
    font-weight: 900;
    line-height: 1;
    color: #ffffff;
    text-shadow:
      3px 3px 0 #cc0505,
      6px 6px 0 #000000;
    transform: perspective(600px) rotateX(8deg) translateZ(0);
    letter-spacing: clamp(2px, 1.2vw, 10px);
    text-transform: uppercase;
    margin: 0;
    text-align: center;
    width: 100%;
    max-width: 100vw;
    overflow: hidden;
    animation:
      flicker-in 0.35s steps(1, start) forwards,
      punch-shake 0.4s 0.35s infinite;
    will-change: transform;
  }

  .new-record {
    font-family: 'Atmospheric';
    font-size: clamp(22px, min(7vh, 9vw), 70px);
    line-height: 1;
    color: #cc0505;
    letter-spacing: clamp(2px, 1vw, 8px);
    margin: 0;
    text-align: center;
    width: 100%;
    max-width: 100vw;
    overflow: hidden;
    text-shadow: 0 0 8px rgba(204, 5, 5, 0.6);
    animation:
      flicker-in 0.4s steps(1, start) forwards,
      record-glitch 1.8s 0.15s ease-out forwards,
      record-pulse 1s 1.95s ease-in-out infinite;
  }

  @keyframes record-glitch {
    0% { transform: none; }
    5% { transform: translate(-3px, 2px); }
    10% { transform: translate(3px, -1px); }
    15%,100% { transform: none; }
  }

  .good-hit {
    font-family: 'Atmospheric';
    font-size: clamp(22px, min(7vh, 9vw), 70px);
    line-height: 1;
    color: #ffffff;
    letter-spacing: clamp(2px, 1vw, 8px);
    margin: 0;
    text-align: center;
    width: 100%;
    max-width: 100vw;
    overflow: hidden;
    text-shadow: 0 0 8px rgba(204, 5, 5, 0.3);
    animation: flicker-in 0.4s steps(1, start) forwards;
  }

  .footer {
    flex: 0 0 auto;
    height: 3vh;
    min-height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .connection-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #222;
  }
  .connection-dot.active {
    background: #cc0505;
    box-shadow: 0 0 6px rgba(204, 5, 5, 0.8);
  }

  /* =============================
     KEYFRAMES
  ============================= */
  @keyframes record-pulse {
    0%, 100% { opacity: 0.8; transform: scale(1); }
    50% { opacity: 1; transform: scale(1.03); }
  }

  @keyframes punch-shake {
    0%, 100% { transform: perspective(600px) rotateX(8deg) translateZ(0); }
    50% { transform: perspective(600px) rotateX(8deg) translateZ(0) translate(2px, 1px); }
  }

  @keyframes led-chase {
    0% { background-position: 0 0; }
    100% { background-position: 0 40px; }
  }

  /* =============================
     NEON FRAME
  ============================= */
  .neon-frame {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 100;
    border: 10px solid #050000;
    box-shadow: inset 0 0 30px rgba(255, 10, 10, 0.3);
    will-change: box-shadow;
  }

  /* =============================
     VIEW TRANSITION OVERLAY
  ============================= */
  .trans-overlay {
    position: absolute;
    inset: 0;
    z-index: 200;
    pointer-events: none;
    opacity: 0;
  }

  .trans-overlay.active {
    opacity: 1;
  }

  /* --- IMPACT: radial shockwave --- */
  .trans-overlay.trans-impact {
    background: rgba(255, 50, 0, 0.4);
    animation: trans-impact 0.5s ease-out forwards;
  }

  @keyframes trans-impact {
    0%   { opacity: 0; transform: scale(0.1); }
    20%  { opacity: 1; transform: scale(1.5); }
    100% { opacity: 0; transform: scale(3); }
  }

  /* --- RESET: CRT power-off --- */
  .trans-overlay.trans-reset {
    background: #000;
    animation: trans-reset 0.4s ease-out forwards;
  }

  @keyframes trans-reset {
    0% { opacity: 1; transform: scaleY(1); }
    25% { opacity: 1; transform: scaleY(0.003); }
    50% { opacity: 1; transform: scaleY(0.003); }
    100% { opacity: 0; transform: scaleY(1); }
  }

</style>
