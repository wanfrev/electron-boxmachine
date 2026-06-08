"""
K11 Boxing - Eel-based arcade machine controller.

Usage:
    python main.py          # Production (Chrome kiosk)
    python main.py dev      # Development (server only)
"""

import eel
import sys
import threading
import time
from pathlib import Path

from backend.config import (
    STATE_ATTRACT, STATE_WAITING, STATE_COUNTDOWN, STATE_READY,
    STATE_ANIMATING, STATE_RESULT,
    COUNTDOWN_DURATION_MS, ANIMATION_DURATION_MS, RESULT_DISPLAY_MS,
    READY_TIMEOUT_MS, RECORDS_FILE, DEFAULT_RECORDS,
)
from backend.hardware import HardwareInput, log
from backend.scoring import calcular_puntaje


eel.init(str(Path(__file__).parent / 'ui' / 'dist'))


class Game:
    def __init__(self):
        self._lock = threading.Lock()
        self._state = STATE_ATTRACT
        self._credits = 0
        self._score = 0
        self._new_record = False
        self._records = self._load_records()
        self._timers = []
        self._hardware = None

    def start(self):
        self._hardware = HardwareInput(self._on_hw_event)
        self._hardware.start()
        self._broadcast_state()

    def stop(self):
        for t in self._timers:
            t.cancel()
        if self._hardware:
            self._hardware.stop()

    def get_state(self):
        with self._lock:
            return self._build_payload()

    def registrar_moneda(self):
        with self._lock:
            self._on_coin()

    def pera_abajo(self):
        with self._lock:
            self._on_pera_abajo()

    def registrar_golpe(self, score):
        with self._lock:
            self._on_punch(score)

    def _on_hw_event(self, event_type, kwargs):
        with self._lock:
            if event_type == 'coin':
                self._on_coin()
            elif event_type == 'pera_abajo':
                self._on_pera_abajo()
            elif event_type == 'punch':
                self._on_punch(kwargs.get('score', 0))

    def _on_coin(self):
        if self._state in (STATE_ATTRACT, STATE_RESULT):
            self._cancel_timers()
        self._credits += 1
        log('Credito insertado. Total: %d', self._credits)
        if self._state in (STATE_ATTRACT, STATE_RESULT):
            self._set_state(STATE_WAITING)
        else:
            self._broadcast_state()

    def _on_pera_abajo(self):
        if self._state == STATE_WAITING and self._credits > 0:
            if self._hardware:
                self._hardware.cancelar_golpe()
            self._set_state(STATE_COUNTDOWN)
            self._schedule(self._on_countdown_done, COUNTDOWN_DURATION_MS / 1000)

    def _on_punch(self, score):
        if self._state != STATE_READY or self._credits <= 0:
            if self._hardware:
                self._hardware.cancelar_golpe()
            return
        self._credits -= 1
        self._score = score
        log('Puntaje: %d. Creditos restantes: %d', score, self._credits)
        self._set_state(STATE_ANIMATING)
        self._schedule(self._on_anim_done, ANIMATION_DURATION_MS / 1000)

    def _on_countdown_done(self):
        with self._lock:
            if self._hardware:
                self._hardware.armar_golpe()
            self._set_state(STATE_READY)
            self._schedule(self._on_ready_timeout, READY_TIMEOUT_MS / 1000)

    def _on_ready_timeout(self):
        with self._lock:
            if self._hardware:
                self._hardware.cancelar_golpe()
            self._set_state(STATE_WAITING)

    def _on_anim_done(self):
        with self._lock:
            is_new = self._score > self._records[0] if self._records else True
            if is_new:
                self._records.append(self._score)
                self._records.sort(reverse=True)
                self._records = self._records[:3]
                self._save_records()
                log('Nuevo record: %d', self._score)
            self._new_record = is_new
            self._set_state(STATE_RESULT)
            self._schedule(self._on_result_done, RESULT_DISPLAY_MS / 1000)

    def _on_result_done(self):
        with self._lock:
            if self._credits > 0:
                self._set_state(STATE_WAITING)
            else:
                self._set_state(STATE_ATTRACT)

    def _set_state(self, new_state):
        old = self._state
        self._state = new_state
        log('Estado: %s -> %s (credits=%d)', old, new_state, self._credits)
        self._broadcast_state()

    def _broadcast_state(self):
        try:
            eel.cambiar_estado(self._build_payload())(self._eel_cb)
        except Exception:
            pass

    def _build_payload(self):
        payload = {
            'state': self._state,
            'credits': self._credits,
            'records': self._records,
        }
        if self._state in (STATE_ANIMATING, STATE_RESULT):
            payload['score'] = self._score
        if self._state == STATE_RESULT:
            payload['newRecord'] = self._new_record
        return payload

    def _schedule(self, fn, delay_sec):
        t = threading.Timer(delay_sec, fn)
        t.daemon = True
        self._timers.append(t)
        t.start()

    def _cancel_timers(self):
        for t in self._timers:
            t.cancel()
        self._timers.clear()

    @staticmethod
    def _eel_cb(_result=None):
        pass

    def _load_records(self):
        try:
            if RECORDS_FILE.exists():
                with open(RECORDS_FILE) as f:
                    lines = [int(l.strip()) for l in f if l.strip().isdigit()]
                    if len(lines) == 3:
                        return lines
        except Exception:
            pass
        return list(DEFAULT_RECORDS)

    def _save_records(self):
        try:
            with open(RECORDS_FILE, 'w') as f:
                for r in self._records:
                    f.write(f'{r}\n')
        except Exception:
            pass


_game = None


@eel.expose
def solicitar_estado():
    if _game:
        return _game.get_state()
    return None


@eel.expose
def registrar_moneda():
    if _game:
        _game.registrar_moneda()
        return _game.get_state()
    return None


@eel.expose
def pera_abajo():
    if _game:
        _game.pera_abajo()
        return _game.get_state()
    return None


@eel.expose
def registrar_golpe(score):
    if _game:
        _game.registrar_golpe(score)
        return _game.get_state()
    return None


def main():
    global _game

    log('K11 Boxing - Iniciando...')

    game = Game()
    _game = game
    game.start()

    port = 8000
    log('K11 Boxing en http://localhost:%d', port)
    eel.start('index.html', mode=False, host='0.0.0.0', port=port)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        log('Interrupcion recibida')
    finally:
        if _game:
            _game.stop()
        log('K11 Boxing detenido')
