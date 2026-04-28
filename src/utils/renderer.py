from __future__ import annotations
import numpy as np

CELL = 32  # pixels per grid cell

# BGR → RGB colors for each tile type
_COLORS = {
    0: (20,  20,  20),   # void
    1: (80,  200, 80),   # start
    2: (240, 220, 40),   # goal
    3: (160, 160, 160),  # solid
    4: (230, 140, 50),   # fragile
    5: (80,  130, 230),  # soft switch
    6: (180, 80,  200),  # hard switch
    7: (60,  200, 200),  # bridge (active)
    8: (220, 80,  200),  # teleporter
    9: (200, 200, 80),   # split
}
_BRIDGE_OFF  = (40, 80, 80)    # bridge inactive
_BLOCK_COLOR = (220, 60,  60)  # block footprint
_BROKEN_COLOR = (40, 30, 30)   # broken fragile tile


def render_frame(env) -> np.ndarray:
    """Return an RGB uint8 array of shape (H_px, W_px, 3)."""
    grid = env._grid
    h, w = grid.shape
    img = np.zeros((h * CELL, w * CELL, 3), dtype=np.uint8)

    block_cells = set(env._block.cells()) if env._block is not None else set()

    for r in range(h):
        for c in range(w):
            tile = grid[r, c]
            if (r, c) in env._fragile_broken:
                color = _BROKEN_COLOR
            elif tile == 7:  # bridge
                bi = env._bridge_tile_to_idx.get((r, c))
                if bi is not None and env._bridge_states[bi]:
                    color = _COLORS[7]
                else:
                    color = _BRIDGE_OFF
            else:
                color = _COLORS.get(tile, (100, 100, 100))

            y0, x0 = r * CELL, c * CELL
            img[y0:y0 + CELL, x0:x0 + CELL] = color
            img[y0, x0:x0 + CELL] = (0, 0, 0)
            img[y0:y0 + CELL, x0] = (0, 0, 0)

    for r, c in block_cells:
        if 0 <= r < h and 0 <= c < w:
            y0, x0 = r * CELL, c * CELL
            inner = 3
            img[y0 + inner:y0 + CELL - inner, x0 + inner:x0 + CELL - inner] = _BLOCK_COLOR

    return img
