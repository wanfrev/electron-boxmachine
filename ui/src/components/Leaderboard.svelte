<script>
  export let records = [];

  const labels = ['1ST', '2ND', '3RD'];
</script>

<div class="leaderboard">
  <div class="header-box">
    <p class="title">HIGH SCORES</p>
  </div>

  <div class="list">
    {#each records as record, i (i)}
      <div class="row" class:first={i === 0} style="--opacity: {i === 0 ? 1 : i === 1 ? 0.7 : 0.5}; --delay: {i * 0.1}s;">
        <div class="rank-cell">
          <span class="rank-label" class:first={i === 0}>{labels[i]}</span>
        </div>
        <div class="score-cell">
          <span class="score" class:first={i === 0}>{String(record).padStart(3, '0')}</span>
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .leaderboard {
    width: 80%;
    max-width: 400px;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
  }

  .header-box {
    text-align: center;
    padding: 4px 0 12px;
    border-bottom: 3px solid #cc0505;
  }

  .title {
    font-family: 'Atmospheric';
    font-size: clamp(28px, 5.5vh, 50px);
    line-height: 1;
    color: #ffffff;
    letter-spacing: 6px;
    margin: 0;
    text-shadow: 0 0 8px rgba(204, 5, 5, 0.5);
    animation: flicker-in 0.4s steps(1, start) forwards;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .row {
    display: flex;
    align-items: center;
    height: 52px;
    background: #121212;
    border: 1px solid rgba(255, 255, 255, 0.04);
    border-radius: 2px;
    opacity: var(--opacity);
    animation: row-in 0.35s ease-out both;
    animation-delay: var(--delay);
    transition: opacity 0.2s;
  }

  .row.first {
    opacity: 1;
    border-color: rgba(204, 5, 5, 0.2);
    background: #1a0a0a;
  }

  @keyframes row-in {
    0% { opacity: 0; transform: translateY(8px); }
    30% { opacity: 1; transform: translateY(8px); }
    100% { opacity: var(--opacity); transform: translateY(0); }
  }

  @keyframes flicker-in {
    0% { opacity: 0; }
    20% { opacity: 0.6; }
    40% { opacity: 1; }
    100% { opacity: 1; }
  }

  .rank-cell {
    flex: 0 0 64px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .rank-label {
    font-family: 'Acumin Variable';
    font-size: clamp(14px, 2.5vh, 20px);
    font-weight: 900;
    color: #ffffff;
    letter-spacing: 2px;
  }

  .rank-label.first {
    color: #cc0505;
    font-size: clamp(17px, 3vh, 26px);
  }

  .score-cell {
    flex: 1;
    display: flex;
    align-items: center;
    padding-left: 12px;
  }

  .score {
    font-family: 'Acumin Variable';
    font-size: clamp(20px, 4vh, 34px);
    font-weight: 700;
    color: #ffffff;
    letter-spacing: 4px;
  }

  .score.first {
    font-size: clamp(24px, 4.8vh, 42px);
    color: #ffffff;
  }
</style>
