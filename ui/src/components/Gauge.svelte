<script>
  export let value = 0;
  export let maxValue = 999;

  const SEGMENTS = 42;
  const VB = 400;
  const CX = VB / 2;
  const CY = VB / 2;
  const R_OUTER = 165;
  const R_INNER = 120;
  const NEEDLE_LEN = 150;

  let needleAngle = 0;
  let inactivePaths = [];
  let activePaths = [];

  $: ratio = Math.min(value / maxValue, 1);
  $: needleAngle = -180 + ratio * 180;
  $: buildSegments(ratio);

  function buildSegments(r) {
    inactivePaths = [];
    activePaths = [];
    const activeCount = Math.round(r * SEGMENTS);

    for (let i = 0; i < SEGMENTS; i++) {
      const t = i / (SEGMENTS - 1);
      const a0 = -180 + t * 180;
      const a1 = -180 + ((i + 0.75) / (SEGMENTS - 1)) * 180;
      const d = arc(a0, a1);
      const color = segmentColor(t);
      const active = i < activeCount;

      if (active) {
        activePaths.push({ d, color, t });
      } else {
        inactivePaths.push({ d });
      }
    }
  }

  function segmentColor(t) {
    if (t < 0.35) return 'hsl(140, 90%, 52%)';
    if (t < 0.65) return `hsl(${140 - (t - 0.35) * 240}, 90%, 52%)`;
    if (t < 0.85) return 'hsl(50, 95%, 55%)';
    return 'hsl(15, 95%, 50%)';
  }

  function polar(cx, cy, r, deg) {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function arc(deg0, deg1) {
    const i0 = polar(CX, CY, R_INNER, deg0);
    const i1 = polar(CX, CY, R_INNER, deg1);
    const o0 = polar(CX, CY, R_OUTER, deg0);
    const o1 = polar(CX, CY, R_OUTER, deg1);
    return [
      `M ${i0.x.toFixed(1)} ${i0.y.toFixed(1)}`,
      `L ${o0.x.toFixed(1)} ${o0.y.toFixed(1)}`,
      `A ${R_OUTER} ${R_OUTER} 0 0 1 ${o1.x.toFixed(1)} ${o1.y.toFixed(1)}`,
      `L ${i1.x.toFixed(1)} ${i1.y.toFixed(1)}`,
      `A ${R_INNER} ${R_INNER} 0 0 0 ${i0.x.toFixed(1)} ${i0.y.toFixed(1)}`,
      'Z',
    ].join(' ');
  }
</script>

<svg viewBox="0 0 {VB} {VB}" class="gauge">
  <defs>
    <filter id="glow">
      <feGaussianBlur stdDeviation="2.5" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <linearGradient id="needleGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ff1e32"/>
      <stop offset="100%" stop-color="#ffffff"/>
    </linearGradient>
  </defs>

  <!-- Inactive segments (dark) -->
  {#each inactivePaths as seg}
    <path d={seg.d} fill="#15171e" stroke="#1e2128" stroke-width="0.5" />
  {/each}

  <!-- Active segments (lit) -->
  {#each activePaths as seg}
    <path
      d={seg.d}
      fill={seg.color}
      stroke={seg.color}
      stroke-width="0.5"
      filter="url(#glow)"
      class="seg-active"
    />
  {/each}

  <!-- Inner arc border -->
  <path
    d={[
      `M ${CX - R_INNER} ${CY}`,
      `A ${R_INNER} ${R_INNER} 0 0 1 ${CX + R_INNER} ${CY}`,
    ].join(' ')}
    stroke="#2a2d38"
    stroke-width="1.5"
    fill="none"
  />
  <path
    d={[
      `M ${CX - R_OUTER} ${CY}`,
      `A ${R_OUTER} ${R_OUTER} 0 0 1 ${CX + R_OUTER} ${CY}`,
    ].join(' ')}
    stroke="#2a2d38"
    stroke-width="1.5"
    fill="none"
  />

  <!-- Needle group -->
  <g
    class="needle-group"
    transform="rotate({needleAngle} {CX} {CY})"
  >
    <line
      x1={CX} y1={CY}
      x2={CX + NEEDLE_LEN} y2={CY}
      stroke="url(#needleGrad)"
      stroke-width="4"
      stroke-linecap="round"
    />
    <!-- Counterweight -->
    <line
      x1={CX} y1={CY}
      x2={CX - 30} y2={CY}
      stroke="#3c4150"
      stroke-width="3"
      stroke-linecap="round"
    />
  </g>

  <!-- Hub -->
  <circle cx={CX} cy={CY} r="30" fill="#0c0c10" stroke="#3c4150" stroke-width="2" />
  <circle cx={CX} cy={CY} r="10" fill="#ff1e32" />
  <circle cx={CX} cy={CY} r="4" fill="#ffffff" />
</svg>

<style>
  .gauge {
    width: 100%;
    height: 100%;
    display: block;
    filter: drop-shadow(0 0 20px rgba(0,0,0,0.5));
  }

  .seg-active {
    transition: fill 0.08s ease;
  }

  .needle-group {
    transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
    filter: drop-shadow(0 0 8px rgba(255, 255, 255, 0.5));
  }
</style>
