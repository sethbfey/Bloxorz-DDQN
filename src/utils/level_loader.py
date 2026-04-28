from pathlib import Path
import json
import numpy as np

LEVELS_DIR = Path(__file__).parent.parent / "envs" / "levels"

TILE_VOID    = 0
TILE_START   = 1
TILE_GOAL    = 2
TILE_SOLID   = 3
TILE_FRAGILE = 4
TILE_SOFT_SW = 5
TILE_HARD_SW = 6
TILE_BRIDGE  = 7
TILE_TELE    = 8
TILE_SPLIT   = 9


def load_level(level_num: int) -> tuple[np.ndarray, tuple[int, int], tuple[int, int]]:
    path = LEVELS_DIR / f"level_{level_num:02d}.txt"
    rows = []
    with open(path) as f:
        for line in f:
            stripped = line.strip()
            if stripped:
                rows.append([int(x) for x in stripped.split()])
    grid = np.array(rows, dtype=np.int32)
    start_pos = tuple(int(x) for x in np.argwhere(grid == TILE_START)[0])
    goal_pos  = tuple(int(x) for x in np.argwhere(grid == TILE_GOAL)[0])
    return grid, start_pos, goal_pos


def load_level_meta(level: int) -> dict:
    path = LEVELS_DIR / f"level_{level:02d}_meta.json"
    if path.exists():
        with open(path) as f:
            return json.load(f)
    return {}
