import sys
from collections import deque
sys.path.insert(0, ".")

from src.utils.block import BlockState, Orientation, Action
from src.utils.level_loader import load_level, TILE_VOID
from src.envs.bloxorz_env import BloxorzEnv


def bfs_solve(level_num: int) -> list[int] | None:
    grid, start, goal = load_level(level_num)
    h, w = grid.shape

    init = BlockState(start[0], start[1], Orientation.STAND)
    queue = deque([(init, [])])
    visited = {init}

    while queue:
        state, path = queue.popleft()
        for action in Action:
            nxt = state.step(action)
            cells = nxt.cells()
            if any(r < 0 or r >= h or c < 0 or c >= w or grid[r, c] == TILE_VOID for r, c in cells):
                continue
            if nxt.orientation == Orientation.STAND and (nxt.r, nxt.c) == goal:
                return path + [int(action)]
            if nxt not in visited:
                visited.add(nxt)
                queue.append((nxt, path + [int(action)]))
    return None


def test_bfs(level_num: int) -> None:
    actions = bfs_solve(level_num)
    assert actions is not None, f"Level {level_num}: BFS found no solution — level may be unsolvable"

    env = BloxorzEnv(level=level_num)
    obs, _ = env.reset()
    total_reward = 0.0
    for a in actions:
        obs, reward, terminated, truncated, info = env.step(a)
        total_reward += reward
        if terminated or truncated:
            break

    assert info["win"], f"Level {level_num}: BFS action sequence did not produce a win in the env"
    print(f"  Level {level_num}: BFS optimal={len(actions)} steps  reward={total_reward:.2f}  ✓")


def test_random(level_num: int, n_episodes: int = 500) -> None:
    env = BloxorzEnv(level=level_num)
    wins, total_steps = 0, 0
    for _ in range(n_episodes):
        env.reset()
        done = False
        ep_steps = 0
        while not done:
            _, _, terminated, truncated, info = env.step(env.action_space.sample())
            ep_steps += 1
            done = terminated or truncated
        wins += int(info.get("win", False))
        total_steps += ep_steps
    print(f"  Level {level_num}: random  win_rate={wins/n_episodes:.1%}  mean_ep_len={total_steps/n_episodes:.1f}")


def test_obs_shape(level_num: int) -> None:
    env = BloxorzEnv(level=level_num)
    obs, _ = env.reset()
    from src.envs.bloxorz_env import MAX_H, MAX_W
    assert obs.shape == (3, MAX_H, MAX_W), f"Bad obs shape: {obs.shape}"
    assert obs.dtype.name == "float32"
    assert obs[1].sum() == 1.0, f"Expected 1 block cell on reset, got {obs[1].sum()}"
    assert obs[2].sum() == 1.0, f"Expected 1 goal cell, got {obs[2].sum()}"
    print(f"  Level {level_num}: obs shape={obs.shape}  dtype={obs.dtype}  ✓")


if __name__ == "__main__":
    for lvl in [1, 3, 6]:
        print(f"\n[Level {lvl}]")
        test_obs_shape(lvl)
        test_bfs(lvl)
        test_random(lvl)
    print("\nAll tests passed.")
