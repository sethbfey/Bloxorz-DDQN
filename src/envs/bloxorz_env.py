from __future__ import annotations
from collections import deque
import numpy as np
import gymnasium as gym
from gymnasium import spaces

from src.utils.block import BlockState, Orientation, Action
from src.utils.level_loader import (
    load_level, load_level_meta,
    TILE_VOID, TILE_FRAGILE,
)

# meaningful in switch mode, else no-op
SWITCH_ACTION = 4

MAX_H = 14
MAX_W = 22

WIN_REWARD  =  10.0
FALL_REWARD =  -1.0
STEP_REWARD =  0.0
MAX_STEPS   =   500


class BloxorzEnv(gym.Env):
    metadata = {"render_modes": ["human", "rgb_array"], "render_fps": 10}

    def __init__(
        self,
        level: int = 1,
        render_mode: str | None = None,
        random_start: bool = False,
        fixed_start_frac: float = 0.0,
        start_temp: float = 0.0,
        potential_shaping: bool = False,
        shaping_gamma: float = 0.99,
    ) -> None:
        super().__init__()
        self.level = level
        self.render_mode = render_mode
        self.random_start = random_start
        self.fixed_start_frac = fixed_start_frac
        self.start_temp = start_temp
        self.potential_shaping = potential_shaping
        self.shaping_gamma = shaping_gamma

        _meta_init = load_level_meta(level)
        self._has_splits: bool = bool(_meta_init.get("splits"))
        _n_ch = 4 if self._has_splits else 3
        self.observation_space = spaces.Box(0.0, 1.0, shape=(_n_ch, MAX_H, MAX_W), dtype=np.float32)
        self.action_space = spaces.Discrete(5 if self._has_splits else 4)

        self._grid: np.ndarray | None = None
        self._start: tuple[int, int] | None = None
        self._goal: tuple[int, int] | None = None
        self._block: BlockState | None = None
        self._steps: int = 0
        self._meta: dict = {}
        self._bridge_states: list[bool] = []
        self._fragile_broken: set = set()
        self._bridge_tile_to_idx: dict = {}
        self._valid_states: list | None = None
        self._start_weights: np.ndarray | None = None
        self._dist_to_win: dict | None = None
        self._window = None
        self._clock = None

        self._split_mode: bool = False
        self._sub_a: tuple[int, int] | None = None
        self._sub_b: tuple[int, int] | None = None
        self._active: int = 0  # 0=A active, 1=B active

    def _cell_walkable(self, r: int, c: int) -> bool:
        h, w = self._grid.shape
        if not (0 <= r < h and 0 <= c < w):
            return False
        tile = self._grid[r, c]
        if tile == TILE_VOID:
            return False
        if (r, c) in self._fragile_broken:
            return False
        bi = self._bridge_tile_to_idx.get((r, c))
        if bi is not None and not self._bridge_states[bi]:
            return False
        return True

    def _has_dynamic_state(self) -> bool:
        return bool(self._meta.get("bridges")) or bool(self._meta.get("teleporters"))

    def _build_bridge_tile_idx(self) -> dict:
        idx = {}
        for i, b in enumerate(self._meta.get("bridges", [])):
            for pos in b["tiles"]:
                idx[(pos[0], pos[1])] = i
        return idx

    def _compute_valid_states(self) -> list:
        h, w = self._grid.shape

        def _state_ok(state: BlockState, bridges: tuple) -> bool:
            if (state.orientation == Orientation.STAND
                    and self._grid[state.r, state.c] == TILE_FRAGILE):
                return False
            for sr, sc in state.cells():
                if not (0 <= sr < h and 0 <= sc < w):
                    return False
                tile = self._grid[sr, sc]
                if tile == TILE_VOID:
                    return False
                bi = self._bridge_tile_to_idx.get((sr, sc))
                if bi is not None and not bridges[bi]:
                    return False
            return True

        if not self._has_dynamic_state():
            valid = []
            for r in range(h):
                for c in range(w):
                    for orient in Orientation:
                        state = BlockState(r, c, orient)
                        if _state_ok(state, ()):
                            valid.append(state)
            return valid

        n_bridges = len(self._meta.get("bridges", []))
        valid = []
        for bits in range(1 << n_bridges):
            bridges = tuple(bool((bits >> i) & 1) for i in range(n_bridges))
            for r in range(h):
                for c in range(w):
                    for orient in Orientation:
                        state = BlockState(r, c, orient)
                        if _state_ok(state, bridges):
                            valid.append((state, bridges))
        return valid

    @staticmethod
    def _apply_sw(states: list, bi: int, sw_action: str) -> None:
        """Apply a switch effect to bridge state list in-place.
        sw_action: 'toggle' (default), 'open' (force active), 'close' (force inactive).
        """
        if sw_action == "open":
            states[bi] = True
        elif sw_action == "close":
            states[bi] = False
        else:
            states[bi] = not states[bi]

    def _bfs_step(self, block: BlockState, bridges: tuple, action: int):
        """One BFS step. Returns (block, bridges) or None on fall.

        Fragile tiles are treated as solid for FLAT traversal but lethal in STAND
        (collapsing under the block's full weight). This matches the env step.
        """
        new_block = block.step(Action(action))
        cells = new_block.cells()
        h, w = self._grid.shape

        for r, c in cells:
            if not (0 <= r < h and 0 <= c < w):
                return None
            if self._grid[r, c] == TILE_VOID:
                return None
            bi = self._bridge_tile_to_idx.get((r, c))
            if bi is not None and not bridges[bi]:
                return None
        if (new_block.orientation == Orientation.STAND
                and self._grid[new_block.r, new_block.c] == TILE_FRAGILE):
            return None

        new_bridges = list(bridges)

        if new_block.orientation == Orientation.STAND:
            for sw in self._meta.get("soft_switches", []):
                if new_block.r == sw["pos"][0] and new_block.c == sw["pos"][1]:
                    bi = sw["controls_bridge_index"]
                    self._apply_sw(new_bridges, bi, sw.get("action", "toggle"))
            for tp in self._meta.get("teleporters", []):
                if new_block.r == tp["entry"][0] and new_block.c == tp["entry"][1]:
                    er, ec = tp["exit"]
                    new_block = BlockState(er, ec, Orientation.STAND)
                    if not (0 <= er < h and 0 <= ec < w and self._grid[er, ec] != TILE_VOID):
                        return None
                    bi = self._bridge_tile_to_idx.get((er, ec))
                    if bi is not None and not new_bridges[bi]:
                        return None

        for sw in self._meta.get("hard_switches", []):
            for r, c in new_block.cells():
                if r == sw["pos"][0] and c == sw["pos"][1]:
                    bi = sw["controls_bridge_index"]
                    self._apply_sw(new_bridges, bi, sw.get("action", "toggle"))

        return new_block, tuple(new_bridges)

    def _compute_dist_to_win(self) -> dict:
        gr, gc = self._goal

        if not self._has_dynamic_state():
            win_state = BlockState(gr, gc, Orientation.STAND)
            valid_set = set(self._valid_states)
            reverse_adj: dict = {s: [] for s in valid_set}
            for s in valid_set:
                for a in range(4):
                    ns = s.step(Action(a))
                    if ns in valid_set:
                        reverse_adj[ns].append(s)
            dist: dict = {win_state: 0}
            queue = deque([win_state])
            while queue:
                s = queue.popleft()
                for prev_s in reverse_adj.get(s, []):
                    if prev_s not in dist:
                        dist[prev_s] = dist[s] + 1
                        queue.append(prev_s)
            return dist

        valid_set = set(self._valid_states)
        win_states = [
            s for s in valid_set
            if s[0] == BlockState(gr, gc, Orientation.STAND)
        ]

        reverse_adj = {s: [] for s in valid_set}
        for block, bridges in valid_set:
            for a in range(4):
                result = self._bfs_step(block, bridges, a)
                if result is not None:
                    ns_key = result
                    if ns_key in valid_set:
                        reverse_adj[ns_key].append((block, bridges))

        dist = {}
        for ws in win_states:
            dist[ws] = 0
        queue = deque(win_states)
        while queue:
            s = queue.popleft()
            for prev_s in reverse_adj.get(s, []):
                if prev_s not in dist:
                    dist[prev_s] = dist[s] + 1
                    queue.append(prev_s)
        return dist

    def _compute_start_weights(self) -> np.ndarray:
        distances = np.array(
            [max(1, self._dist_to_win.get(s, 9999)) for s in self._valid_states], dtype=np.float32
        )
        w = np.exp(-self.start_temp * distances)
        return w / w.sum()

    def reset(self, seed: int | None = None, options: dict | None = None) -> tuple[np.ndarray, dict]:
        super().reset(seed=seed)
        self._grid, self._start, self._goal = load_level(self.level)
        self._meta = load_level_meta(self.level)
        self._bridge_tile_to_idx = self._build_bridge_tile_idx()
        self._bridge_states = [b["initially_active"] for b in self._meta.get("bridges", [])]
        self._fragile_broken = set()
        self._split_mode = False
        self._sub_a = None
        self._sub_b = None
        self._active = 0

        if self._valid_states is None:
            self._valid_states = self._compute_valid_states()

        if (self._dist_to_win is None
                and not self._has_splits
                and (self.potential_shaping or self.start_temp > 0.0)):
            self._dist_to_win = self._compute_dist_to_win()

        if options and "start_state" in options:
            start = options["start_state"]
            if (self._has_dynamic_state()
                    and isinstance(start, tuple)
                    and len(start) == 2
                    and isinstance(start[0], BlockState)):
                self._block, bridge_t = start
                self._bridge_states = list(bridge_t)
            else:
                self._block = start
        elif self.random_start and self.np_random.random() >= self.fixed_start_frac:
            if self.start_temp > 0.0 and self._dist_to_win is not None:
                if self._start_weights is None:
                    self._start_weights = self._compute_start_weights()
                idx = int(self.np_random.choice(len(self._valid_states), p=self._start_weights))
            else:
                idx = int(self.np_random.integers(len(self._valid_states)))
            start = self._valid_states[idx]
            if self._has_dynamic_state():
                self._block, bridge_t = start
                self._bridge_states = list(bridge_t)
            else:
                self._block = start
        else:
            self._block = BlockState(self._start[0], self._start[1], Orientation.STAND)

        self._steps = 0
        return self._build_obs(), {}

    def step(self, action: int) -> tuple[np.ndarray, float, bool, bool, dict]:
        assert self._block is not None or self._split_mode, "call reset() before step()"

        if self._split_mode:
            return self._step_split(action)

        if action == SWITCH_ACTION:
            truncated = self._steps >= MAX_STEPS
            return self._build_obs(), STEP_REWARD, False, truncated, {"win": False, "fall": False}

        old_block = self._block
        old_bridges = list(self._bridge_states)
        new_block = self._block.step(Action(action))
        cells = new_block.cells()
        h, w = self._grid.shape

        fell = False
        for r, c in cells:
            if r < 0 or r >= h or c < 0 or c >= w:
                fell = True; break
            tile = self._grid[r, c]
            if tile == TILE_VOID:
                fell = True; break
            if (r, c) in self._fragile_broken:
                fell = True; break
            bi = self._bridge_tile_to_idx.get((r, c))
            if bi is not None and not self._bridge_states[bi]:
                fell = True; break

        if fell:
            return self._build_obs(), FALL_REWARD, True, False, {"win": False, "fall": True}

        self._block = new_block
        self._steps += 1

        # Real Bloxorz: STAND on a fragile tile collapses it under the block's
        # full weight. FLAT distributes weight across two cells and is safe.
        if (new_block.orientation == Orientation.STAND
                and self._grid[new_block.r, new_block.c] == TILE_FRAGILE):
            self._fragile_broken.add((new_block.r, new_block.c))
            return self._build_obs(), FALL_REWARD, True, False, {"win": False, "fall": True}

        if new_block.orientation == Orientation.STAND:
            for sw in self._meta.get("soft_switches", []):
                pos = sw["pos"]
                if new_block.r == pos[0] and new_block.c == pos[1]:
                    bi = sw["controls_bridge_index"]
                    self._apply_sw(self._bridge_states, bi, sw.get("action", "toggle"))

        for sw in self._meta.get("hard_switches", []):
            pos = sw["pos"]
            for r, c in new_block.cells():
                if r == pos[0] and c == pos[1]:
                    bi = sw["controls_bridge_index"]
                    self._apply_sw(self._bridge_states, bi, sw.get("action", "toggle"))

        if new_block.orientation == Orientation.STAND:
            for tp in self._meta.get("teleporters", []):
                if new_block.r == tp["entry"][0] and new_block.c == tp["entry"][1]:
                    er, ec = tp["exit"]
                    new_block = BlockState(er, ec, Orientation.STAND)
                    self._block = new_block
                    bi = self._bridge_tile_to_idx.get((er, ec))
                    if (er < 0 or er >= h or ec < 0 or ec >= w
                            or self._grid[er, ec] == TILE_VOID
                            or (bi is not None and not self._bridge_states[bi])):
                        return self._build_obs(), FALL_REWARD, True, False, {"win": False, "fall": True}
                    break

        if new_block.orientation == Orientation.STAND:
            for sp in self._meta.get("splits", []):
                if new_block.r == sp["trigger"][0] and new_block.c == sp["trigger"][1]:
                    dest_a = (int(sp["dest_a"][0]), int(sp["dest_a"][1]))
                    dest_b = (int(sp["dest_b"][0]), int(sp["dest_b"][1]))
                    if not self._cell_walkable(*dest_a) or not self._cell_walkable(*dest_b):
                        return self._build_obs(), FALL_REWARD, True, False, {"win": False, "fall": True}
                    self._split_mode = True
                    self._sub_a = dest_a
                    self._sub_b = dest_b
                    self._active = 0
                    truncated = self._steps >= MAX_STEPS
                    return self._build_obs(), STEP_REWARD, False, truncated, {"win": False, "fall": False}

        won = (
            self._block.orientation == Orientation.STAND
            and (self._block.r, self._block.c) == self._goal
        )

        reward = WIN_REWARD if won else STEP_REWARD

        if self.potential_shaping and self._dist_to_win is not None:
            if self._has_dynamic_state():
                old_key = (old_block, tuple(old_bridges))
                new_key = (self._block, tuple(self._bridge_states))
                d_before = self._dist_to_win.get(old_key)
                d_after = 0 if won else self._dist_to_win.get(new_key)
            else:
                d_before = self._dist_to_win.get(old_block)
                d_after = 0 if won else self._dist_to_win.get(self._block)
            if d_before is not None and d_after is not None:
                reward += d_before - self.shaping_gamma * d_after

        truncated = (not won) and (self._steps >= MAX_STEPS)
        return self._build_obs(), reward, won, truncated, {"win": won, "fall": False}

    def _step_split(self, action: int) -> tuple[np.ndarray, float, bool, bool, dict]:
        if action == SWITCH_ACTION:
            self._active ^= 1
            self._steps += 1
            truncated = self._steps >= MAX_STEPS
            return self._build_obs(), STEP_REWARD, False, truncated, {"win": False, "fall": False}

        dr, dc = [(-1, 0), (0, 1), (1, 0), (0, -1)][action]

        old_r, old_c = self._sub_a if self._active == 0 else self._sub_b
        new_r, new_c = old_r + dr, old_c + dc

        if not self._cell_walkable(new_r, new_c):
            return self._build_obs(), FALL_REWARD, True, False, {"win": False, "fall": True}

        if self._active == 0:
            self._sub_a = (new_r, new_c)
        else:
            self._sub_b = (new_r, new_c)
        self._steps += 1

        # Soft switches require the combined STAND block — sub-blocks never trigger them.
        for sw in self._meta.get("hard_switches", []):
            if new_r == sw["pos"][0] and new_c == sw["pos"][1]:
                self._apply_sw(self._bridge_states, sw["controls_bridge_index"],
                               sw.get("action", "toggle"))

        a_r, a_c = self._sub_a
        b_r, b_c = self._sub_b

        combined: BlockState | None = None
        if a_r == b_r and a_c == b_c:
            combined = BlockState(a_r, a_c, Orientation.STAND)
        elif a_r == b_r and abs(a_c - b_c) == 1:
            combined = BlockState(a_r, min(a_c, b_c), Orientation.FLAT_H)
        elif a_c == b_c and abs(a_r - b_r) == 1:
            combined = BlockState(min(a_r, b_r), a_c, Orientation.FLAT_V)

        if combined is not None:
            # Both sub-blocks were already on valid tiles, so the merged block is valid
            self._split_mode = False
            self._block = combined

            won = (combined.orientation == Orientation.STAND
                   and (combined.r, combined.c) == self._goal)
            reward = WIN_REWARD if won else STEP_REWARD
            truncated = (not won) and (self._steps >= MAX_STEPS)
            return self._build_obs(), reward, won, truncated, {"win": won, "fall": False}

        truncated = self._steps >= MAX_STEPS
        return self._build_obs(), STEP_REWARD, False, truncated, {"win": False, "fall": False}

    def render(self):
        if self.render_mode == "rgb_array":
            from src.utils.renderer import render_frame
            return render_frame(self)
        if self.render_mode == "human":
            from src.utils.renderer import render_frame
            import pygame
            frame = render_frame(self)
            if self._window is None:
                pygame.init()
                h_px, w_px = frame.shape[:2]
                self._window = pygame.display.set_mode((w_px, h_px))
                self._clock = pygame.time.Clock()
                pygame.display.set_caption(f"Bloxorz Level {self.level}")
            surf = pygame.surfarray.make_surface(frame.transpose(1, 0, 2))
            self._window.blit(surf, (0, 0))
            pygame.display.flip()
            self._clock.tick(self.metadata["render_fps"])

    def close(self) -> None:
        if self._window is not None:
            import pygame
            pygame.display.quit()
            pygame.quit()
            self._window = None

    def _build_obs(self) -> np.ndarray:
        n_ch = 4 if self._has_splits else 3
        img = np.zeros((n_ch, MAX_H, MAX_W), dtype=np.float32)

        # CH0: walkable static grid (bridges only when active; broken fragile = void)
        h, w = self._grid.shape
        for r in range(h):
            for c in range(w):
                tile = self._grid[r, c]
                if (r, c) in self._fragile_broken:
                    pass
                elif (r, c) in self._bridge_tile_to_idx:
                    bi = self._bridge_tile_to_idx[(r, c)]
                    if self._bridge_states[bi]:
                        img[0, r, c] = 1.0
                elif tile != TILE_VOID:
                    img[0, r, c] = 1.0

        # CH1: active block footprint
        # CH2: inactive sub-block footprint; zeros when not in split mode
        if self._split_mode:
            active_pos   = self._sub_a if self._active == 0 else self._sub_b
            inactive_pos = self._sub_b if self._active == 0 else self._sub_a
            if active_pos:
                img[1, active_pos[0], active_pos[1]] = 1.0
            if inactive_pos and self._has_splits:
                img[2, inactive_pos[0], inactive_pos[1]] = 1.0
        elif self._block is not None:
            for r, c in self._block.cells():
                img[1, r, c] = 1.0

        gr, gc = self._goal
        img[n_ch - 1, gr, gc] = 1.0
        return img
