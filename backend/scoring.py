import random
from backend.config import SCORE_TABLE, DIFFICULTY_FACTOR, SCORE_NOISE, MAX_SCORE, SCORE_MIN


def clamp(value, minimum, maximum):
    return max(minimum, min(value, maximum))


def calcular_puntaje(dt_segundos):
    dt_ms = dt_segundos * 1000.0

    if dt_ms <= SCORE_TABLE[0][0]:
        puntos = SCORE_TABLE[0][1]
    elif dt_ms >= SCORE_TABLE[-1][0]:
        puntos = SCORE_TABLE[-1][1]
    else:
        puntos = 0
        for i in range(len(SCORE_TABLE) - 1):
            t0, s0 = SCORE_TABLE[i]
            t1, s1 = SCORE_TABLE[i + 1]
            if t0 <= dt_ms <= t1:
                frac = (dt_ms - t0) / max(t1 - t0, 0.0001)
                puntos = int(s0 + frac * (s1 - s0))
                break

    puntos = int(puntos * DIFFICULTY_FACTOR)
    if SCORE_NOISE > 0:
        puntos += random.randint(-SCORE_NOISE, SCORE_NOISE)
    return int(clamp(puntos, SCORE_MIN, MAX_SCORE))
