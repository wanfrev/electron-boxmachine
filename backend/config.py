import os
from pathlib import Path

WS_HOST = '0.0.0.0'
WS_PORT = 8765
UI_PORT = 5000

PIN_MONEDERO = 22
PIN_SENSOR_ABAJO = 5
PIN_SENSOR_ARRIBA = 6

DEBOUNCE_COIN_MS = 500
MAX_PUNCH_WINDOW_MS = 150
MIN_PUNCH_DT_US = 2000

SCORE_TABLE = [
    (4.0, 980),
    (6.0, 920),
    (8.0, 850),
    (10.0, 780),
    (12.0, 700),
    (14.0, 620),
    (16.0, 550),
    (18.0, 480),
    (20.0, 420),
    (25.0, 280),
    (30.0, 180),
    (35.0, 100),
    (40.0, 60),
    (45.0, 35),
    (50.0, 20),
    (80.0, 10),
    (120.0, 0),
]

DIFFICULTY_FACTOR = 1.2
SCORE_NOISE = 8
MAX_SCORE = 999
SCORE_MIN = 0

STATE_ATTRACT = 'attract'
STATE_WAITING = 'waiting'
STATE_COUNTDOWN = 'countdown'
STATE_READY = 'ready'
STATE_ANIMATING = 'animating'
STATE_RESULT = 'result'

COUNTDOWN_DURATION_MS = 3000
IDLE_VIDEO_TIMEOUT_MS = 30000
ANIMATION_DURATION_MS = 1600
RESULT_DISPLAY_MS = 4000
READY_TIMEOUT_MS = 15000

BASE_DIR = Path(__file__).resolve().parent.parent
ASSETS_DIR = BASE_DIR / 'assets'
VIDEO_DIRS = [
    ASSETS_DIR,
    Path('/media/pi/PENDRIVE/videos'),
    Path('/media/usb/videos'),
    Path('/mnt/usb/videos'),
]

VIDEO_GLOB = '*.mp4'

RECORDS_FILE = BASE_DIR / 'records.txt'
DEFAULT_RECORDS = [850, 720, 500]
