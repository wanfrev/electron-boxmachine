import random
import sys
import time
import threading
from backend.config import PIN_MONEDERO, PIN_SENSOR_ABAJO, PIN_SENSOR_ARRIBA, DEBOUNCE_COIN_MS, MAX_PUNCH_WINDOW_MS, MIN_PUNCH_DT_US, MAX_SCORE, SCORE_MIN
from backend.scoring import calcular_puntaje


def log(msg, *args):
    ts = time.strftime('%Y-%m-%d %H:%M:%S')
    if args:
        try:
            msg = msg % args
        except Exception:
            pass
    print(f'[{ts}] {msg}', flush=True)


class HardwareInput:
    def __init__(self, event_callback):
        self.event_callback = event_callback
        self._running = False
        self._thread = None

        self._golpe_armado = False
        self._t_inicio_golpe = 0.0
        self._pera_abajo_latch = False
        self._ultimo_coin_ms = 0.0

        self._gpio = None
        self._init_gpio()

    def _init_gpio(self):
        try:
            from gpiozero import Button

            monedero = Button(PIN_MONEDERO, pull_up=True, bounce_time=0.02)
            sensor_abajo = Button(PIN_SENSOR_ABAJO, pull_up=True, bounce_time=0.01)
            sensor_arriba = Button(PIN_SENSOR_ARRIBA, pull_up=True, bounce_time=0.01)

            monedero.when_released = self._on_coin
            sensor_abajo.when_pressed = self._on_posible_pera_abajo
            sensor_arriba.when_pressed = self._on_posible_pera_abajo
            sensor_abajo.when_released = self._on_pera_inicia_subida
            sensor_arriba.when_released = self._on_pera_golpea_tope

            self._gpio = {
                'monedero': monedero,
                'sensor_abajo': sensor_abajo,
                'sensor_arriba': sensor_arriba,
            }
            log('GPIO listo. Pines: COIN=%d, ABAJO=%d, ARRIBA=%d',
                PIN_MONEDERO, PIN_SENSOR_ABAJO, PIN_SENSOR_ARRIBA)
        except Exception as e:
            self._gpio = None
            log('GPIO no disponible (%s). Usando teclado.', str(e))

    @property
    def hardware_conectado(self):
        return self._gpio is not None

    def start(self):
        self._running = True
        if not self.hardware_conectado:
            self._thread = threading.Thread(target=self._keyboard_loop, daemon=True)
            self._thread.start()

    def stop(self):
        self._running = False
        if self._gpio:
            for dev in self._gpio.values():
                try:
                    dev.close()
                except Exception:
                    pass

    def _emit(self, event_type, **kwargs):
        try:
            self.event_callback(event_type, kwargs)
        except Exception:
            pass

    def armar_golpe(self):
        self._golpe_armado = True
        self._t_inicio_golpe = 0.0
        log('Golpe armado')

    def cancelar_golpe(self):
        self._golpe_armado = False
        self._t_inicio_golpe = 0.0
        self._pera_abajo_latch = False

    def _on_coin(self):
        ahora_ms = time.perf_counter() * 1000.0
        if (ahora_ms - self._ultimo_coin_ms) < DEBOUNCE_COIN_MS:
            return
        gpio = self._gpio
        if gpio and gpio['monedero'].is_pressed:
            return
        self._ultimo_coin_ms = ahora_ms
        log('Moneda detectada')
        self._emit('coin')

    def _on_posible_pera_abajo(self):
        gpio = self._gpio
        if not gpio:
            return
        if not gpio['sensor_abajo'].is_pressed or not gpio['sensor_arriba'].is_pressed:
            self._pera_abajo_latch = False
            return
        if self._pera_abajo_latch:
            return
        self._pera_abajo_latch = True
        log('Pera abajo (ambos sensores)')
        self._emit('pera_abajo')

    def _on_pera_inicia_subida(self):
        self._pera_abajo_latch = False
        if not self._golpe_armado:
            return
        gpio = self._gpio
        if gpio and not gpio['sensor_arriba'].is_pressed:
            self.cancelar_golpe()
            return
        self._t_inicio_golpe = time.perf_counter()
        log('Pera inicia subida - temporizador iniciado')

    def _on_pera_golpea_tope(self):
        if not self._golpe_armado or self._t_inicio_golpe <= 0:
            return

        dt = time.perf_counter() - self._t_inicio_golpe
        dt_us = int(dt * 1_000_000.0)

        if dt_us < MIN_PUNCH_DT_US:
            log('Golpe ignorado: dt=%dus < minimo', dt_us)
            self.cancelar_golpe()
            return
        if dt > (MAX_PUNCH_WINDOW_MS / 1000.0):
            log('Golpe ignorado: dt=%.3fs > ventana=%dms', dt, MAX_PUNCH_WINDOW_MS)
            self.cancelar_golpe()
            return

        self.cancelar_golpe()
        score = calcular_puntaje(dt)
        log('Golpe! tiempo=%.3fs score=%d', dt, score)
        self._emit('punch', score=score)

    def _simular_golpe(self):
        score = random.randint(SCORE_MIN, MAX_SCORE)
        log('Golpe simulado (tecla): score=%d', score)
        self._emit('punch', score=score)

    def _keyboard_loop(self):
        if sys.platform == 'win32':
            self._keyboard_loop_windows()
        else:
            self._keyboard_loop_unix()

    def _keyboard_loop_windows(self):
        import msvcrt
        log('Modo teclado Windows. C=coin, SPACE=pera/golpe, Q=salir')
        while self._running:
            if msvcrt.kbhit():
                ch = msvcrt.getch().decode('ascii', errors='ignore').lower()
                self._handle_key(ch)

    def _keyboard_loop_unix(self):
        import termios
        import tty
        fd = sys.stdin.fileno()
        old = termios.tcgetattr(fd)
        try:
            tty.setraw(fd)
            log('Modo teclado Unix. C=coin, SPACE=pera/golpe, Q=salir')
            while self._running:
                ch = sys.stdin.read(1).lower()
                self._handle_key(ch)
        finally:
            termios.tcsetattr(fd, termios.TCSADRAIN, old)

    def _handle_key(self, ch):
        if ch == 'c' or ch == 'm':
            self._on_coin()
        elif ch == ' ':
            if self._golpe_armado:
                log('Golpe simulado por teclado')
                self._simular_golpe()
            else:
                log('Pera abajo simulada por teclado')
                self._emit('pera_abajo')
        elif ch == 'q':
            self._emit('quit')
