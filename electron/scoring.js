const {
  SCORE_TABLE,
  DIFFICULTY_FACTOR,
  SCORE_NOISE,
  MAX_SCORE,
  SCORE_MIN,
} = require('./config');

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(value, maximum));
}

function calcularPuntaje(dtSegundos) {
  const dtMs = dtSegundos * 1000;

  let puntos;
  if (dtMs <= SCORE_TABLE[0][0]) {
    puntos = SCORE_TABLE[0][1];
  } else if (dtMs >= SCORE_TABLE[SCORE_TABLE.length - 1][0]) {
    puntos = SCORE_TABLE[SCORE_TABLE.length - 1][1];
  } else {
    let found = false;
    for (let i = 0; i < SCORE_TABLE.length - 1 && !found; i++) {
      const [t0, s0] = SCORE_TABLE[i];
      const [t1, s1] = SCORE_TABLE[i + 1];
      if (dtMs >= t0 && dtMs <= t1) {
        const frac = (dtMs - t0) / Math.max(t1 - t0, 0.0001);
        puntos = Math.round(s0 + frac * (s1 - s0));
        found = true;
      }
    }
    if (!found) puntos = SCORE_TABLE[SCORE_TABLE.length - 1][1];
  }

  puntos = Math.round(puntos * DIFFICULTY_FACTOR);
  if (SCORE_NOISE > 0) {
    puntos += Math.floor(Math.random() * (2 * SCORE_NOISE + 1)) - SCORE_NOISE;
  }
  return clamp(puntos, SCORE_MIN, MAX_SCORE);
}

module.exports = { calcularPuntaje };
