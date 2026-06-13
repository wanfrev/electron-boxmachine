const {
  DIFFICULTY_FACTOR,
  SCORE_NOISE,
  MAX_SCORE,
  SCORE_MIN,
  SCORE_HALF_TIME_MS,
  SCORE_STEEPNESS,
} = require('./config');

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(value, maximum));
}

function calcularPuntaje(dtSegundos) {
  const dtMs = dtSegundos * 1000;

  const puntos = MAX_SCORE / (1 + Math.pow(dtMs / SCORE_HALF_TIME_MS, SCORE_STEEPNESS));

  const ajustado = Math.round(puntos * DIFFICULTY_FACTOR);

  let ruidoAgregado = ajustado;
  if (SCORE_NOISE > 0) {
    ruidoAgregado += Math.floor(Math.random() * (2 * SCORE_NOISE + 1)) - SCORE_NOISE;
  }

  return clamp(ruidoAgregado, SCORE_MIN, MAX_SCORE);
}

module.exports = { calcularPuntaje };
