from __future__ import annotations
import json
import re
import sys
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))

from src.envs.bloxorz_env import BloxorzEnv, MAX_H, MAX_W

app = FastAPI()

_sessions: dict[str, BloxorzEnv] = {}

RUNS_DIR = ROOT / "runs"
LEVELS_DIR = ROOT / "src" / "envs" / "levels"


def _serialize(env: BloxorzEnv, *, done=False, won=False, fell=False, action=None) -> dict:
    block = env._block
    block_data = None
    if block is not None:
        block_data = {"r": int(block.r), "c": int(block.c), "orientation": int(block.orientation)}

    split_data = None
    if env._split_mode:
        split_data = {
            "sub_a": {"r": int(env._sub_a[0]), "c": int(env._sub_a[1])},
            "sub_b": {"r": int(env._sub_b[0]), "c": int(env._sub_b[1])},
            "active": int(env._active),
        }

    return {
        "grid": env._grid.tolist(),
        "block": block_data,
        "split": split_data,
        "bridges": [bool(b) for b in env._bridge_states],
        "fragile_broken": [[int(r), int(c)] for r, c in env._fragile_broken],
        "goal": {"r": int(env._goal[0]), "c": int(env._goal[1])},
        "start": {"r": int(env._start[0]), "c": int(env._start[1])},
        "rows": int(env._grid.shape[0]),
        "cols": int(env._grid.shape[1]),
        "meta": env._meta,
        "done": done,
        "won": won,
        "fell": fell,
        "steps": int(env._steps),
        "action": action,
    }


@app.get("/api/levels")
def api_levels():
    levels = []
    for i in range(1, 34):
        txt = LEVELS_DIR / f"level_{i:02d}.txt"
        if not txt.exists():
            continue
        with open(txt) as f:
            grid = [[int(x) for x in ln.split()] for ln in f if ln.strip()]
        meta_path = LEVELS_DIR / f"level_{i:02d}_meta.json"
        meta: dict = {}
        if meta_path.exists():
            with open(meta_path) as f:
                meta = json.load(f)
        levels.append({
            "num": i,
            "rows": len(grid),
            "cols": len(grid[0]) if grid else 0,
            "grid": grid,
            "meta": meta,
        })
    return {"levels": levels}


@app.get("/api/checkpoints")
def api_checkpoints():
    result: dict[int, list[dict]] = {}
    if RUNS_DIR.exists():
        for f in sorted(RUNS_DIR.glob("*_best.pt")):
            m = re.search(r"level(\d+)", f.name)
            if not m:
                continue
            lvl = int(m.group(1))
            result.setdefault(lvl, []).append({"level": lvl, "filename": f.name, "path": str(f)})
    return {"checkpoints": result}


@app.post("/api/play/start")
def api_play_start(level: int):
    try:
        env = BloxorzEnv(level=level)
        env.reset()
        sid = str(uuid.uuid4())
        _sessions[sid] = env
        return {"session_id": sid, **_serialize(env)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/play/{sid}/step")
def api_play_step(sid: str, action: int):
    env = _sessions.get(sid)
    if env is None:
        raise HTTPException(status_code=404, detail="Session not found")
    _, _, terminated, truncated, info = env.step(action)
    won = bool(info.get("win", False))
    fell = bool(info.get("fall", False))
    done = terminated or truncated
    state = _serialize(env, done=done, won=won, fell=fell, action=action)
    if done:
        del _sessions[sid]
    return state


@app.get("/api/watch/{level}")
def api_watch(level: int, checkpoint: str):
    import torch
    import torch.nn as nn

    try:
        ckpt = torch.load(checkpoint, map_location="cpu", weights_only=False)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Cannot load checkpoint: {e}")

    in_channels = ckpt.get("in_channels") or int(ckpt["q_network"]["conv.0.weight"].shape[1])
    n_actions   = ckpt.get("n_actions")   or int(ckpt["q_network"]["fc.2.weight"].shape[0])

    class _QNet(nn.Module):
        def __init__(self, in_ch, n_act):
            super().__init__()
            self.conv = nn.Sequential(
                nn.Conv2d(in_ch, 32, 3, padding=1), nn.ReLU(),
                nn.Conv2d(32, 64, 3, padding=1), nn.ReLU(),
                nn.Conv2d(64, 64, 3, padding=1), nn.ReLU(),
            )
            self.fc = nn.Sequential(
                nn.Linear(64 * MAX_H * MAX_W, 256), nn.ReLU(),
                nn.Linear(256, n_act),
            )
        def forward(self, x):
            return self.fc(self.conv(x).flatten(1))

    q_net = _QNet(in_channels, n_actions)
    q_net.load_state_dict(ckpt["q_network"])
    q_net.eval()

    env = BloxorzEnv(level=level)
    obs, _ = env.reset()
    states = [_serialize(env)]

    with torch.no_grad():
        done = False
        while not done:
            obs_t = torch.from_numpy(obs).unsqueeze(0).float()
            act = int(q_net(obs_t).argmax().item())
            obs, _, terminated, truncated, info = env.step(act)
            done = terminated or truncated
            won = bool(info.get("win", False))
            fell = bool(info.get("fall", False))
            states.append(_serialize(env, done=done, won=won, fell=fell, action=act))

    return {"states": states, "won": states[-1]["won"]}

_static = Path(__file__).parent / "static"
app.mount("/", StaticFiles(directory=_static, html=True), name="static")
