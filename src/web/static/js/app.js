// ── App state ─────────────────────────────────────────────────────────────────
const App = {
  mode: 'play',
  currentLevel: null,
  levels: [],
  checkpoints: {},
  levelDataLoaded: false,

  // play
  sessionId: null,
  gameState: null,

  // watch
  watchStates: [],
  watchIdx: 0,
  watchPlaying: false,
  watchSpeed: 1,
  watchTimer: null,

  // animation
  anim: null,          // { fromBlock, action, progress, startMs, durationMs, activeSub?, isMerge?, inactiveSub? }
  splitSwitchAnim: null, // { startMs, durationMs } — SWITCH flash
  splitEntryAnim: null, // { startMs, durationMs, triggerR, triggerC, subA, subB } — teleport burst
  bridgeAnims: [],     // [{ bridgeIdx, opening, t, startMs, durationMs }]
  fallAnim: null,       // { startMs, durationMs, resultState } — win: sink into goal hole
  edgeFallAnim: null,  // { startMs, durationMs, resultState, action } — fail: drop off edge
  rafId: null,
  glowTime: 0,
  flashColor: null,
  flashUntil: 0,
  resultShown: false,
  hintVisible: false,
};

const ANIM_MS        = 220;
const BRIDGE_ANIM_MS = 380;
const SWITCH_ANIM_MS = 300;

// ── Optimal hint data ─────────────────────────────────────────────────────────
const OPTIMAL_MOVES = {
  1:  'R2,D,R3,D',
  2:  'U,R,D,R3,U3,R,D2,R4,U,L,U',
  3:  'R,U,R3,U,L,D,R,U2,R3,D3,R,U',
  4:  'U,L,U,R2,U,R6,D,R,D5,R,U,L6,D',
  5:  'L3,R,L5,D,R,D2,R4,D,R4,L4,D,L6',
  6:  'R3,D2,R,D2,R,D,R,U,L3,U2,L,U3,R3,D2,R,D,R,D,R,U2,L,D,R,U,L,D,R',
  7:  'D,L,U,R5,D,R,L,U,L5,D,R,D,R,D,R3,U2,R,D,L,U,R,U2,R3,D,R,D,R,D,L,U',
  8:  'R2,D3,R2,S,U3,R2',
  9:  'R,D,R6,U,R,D,L5,U,S,D,R5,D',
  10: 'R2,L,D3,R,D5,L4,U,L3,D,U,R3,D,R3,U,S,R2,D3,R,D3,L,D,U,R,U3,L,U2,R,S,R2,L7',
  11: 'R4,U,L,D3,R4,U2,L,U2,L3,D,R,U,R2,D,R,U,L3,D2,L3,U2,R,U2,L,D,R,U,R,D,L',
  12: 'L,D,R,U,R,U,R,U,R,U,L,D,R,U,R3,D2,L,D,R,U,L,D,R,U,L,D,L,U,R,U3,L3,R3,D3,L,D,R,U2,R,D,L,D,R,U3,R,U,D,L,D3,L,U,R,U2,L3,U,L,D,R2,U,L,D3,L',
  13: 'U,L,D,R,D,L,U,R2,D,L,U4,L7,D3,R,U,L,D,R,D2,R,D2,R,U,L2,D,R,U2,L,D,R,U,R2,U2',
  14: 'R3,U2,R,D,L2,U,R,D2,R2,D4,L3,D,R,U,R2,U2,D2,L2,D,R,D,R2,L2,U,L2,U,R3,U4,L6,U,R,D,L5,D3,R,D,R',
  15: 'R4,U2,S,U5,R3,U2,R4,D2,U2,R2,S,L2,R,L3,U,R,D,L2,U,R,D,L3,D,L3,D4,L,U,R,D,R7',
  16: 'R4,S,R,D,S,R,U,S,R,L3,S,R3,S,R5,L4,R8,S,D,R9',
  17: 'D5,L,U,R5,U,R3,L3,D,L4,U6,R4,D,R4,U,L,D,R2,U,L,D2,R,U,L,D,U,R,D,L,U2,R,D,L2,U,R,D,L4,U,L4,D6,R4,U,R3,D2,U,L,U,L3,D,L3,U,L,U3,R5,D,R3',
  18: 'R,D,L,U,R2,D,L,U,R3,U2,D2,L3,D,R,U,L2,D,R,U,R3,D2,U2,L3,D,L,U,R2,D,L,U2,R,D,L,U,L2,D4,R2,L2,U4,R2,D,R,U,L,D2,R,U,L,D,R,U,R5,D3,R,U,L,D2,R,U,L,D,L,U,R',
  19: 'R8,D,R,U,L6,D,R,U,R5,D5,L5,D,L,U,R6,U,L,D,L5,D4,R3,L6,U2',
  20: 'D,L,D,R,D,L,U2,R,U2,L4,D2,R,U,L2,D3,L,D,U,R,U2,R,U2,R3,D3,L,U,S,L,U,D,R,S,L5,D5,R5,D',
  21: 'R,D,L,U,L,D,R,U,R2,U,R3,U,L,D3,U3,R,D,L3,D,L2,D,L,U,R,D,R,U,L,D,R,U,L,D,R,D2,R,D2,R3,U2,D2,L2,U,L,D,R3,U4,R3',
  22: 'R,U,L,D,L,U,R3,U,R2,D,R,D,R2,U,L,D,L,U,L,D,R2,D3,L,D,U,R,U3,L2,U,R,D,R,D,R,U,L3,U,L3,D,L,D,L2,U,R,D2,L,U,R2,D,L,U2,R,D,L,U,R,D,L,D3,R,D,U,L,U3,R,U,L,D,L,U,R3,U,R2,D,R2,D2,L,U,R3,U',
  23: 'D,L,U,R,D2,R,U,R6,U,L,D,R,L3,U5,R4,U,D,L6,D4,L7,U3,R2,U,D,L,U,R,D2,R,D3,R8,U,L,D,R,L4,U3,S,D,R2,D3,R4,U2',
  24: 'D2,R2,U2,R,U,R4,U,R,D,L2,U,R,D,L,R,U,L,D,L,U,R,D,L4,D,L3,D,L,D,R,D,L,U2,D2,R,U,L,U,R,U,R3,U,R4,U,L,D,R,U,R,D,L6,D,R,L,U,R6,U,L,D,L,U,R,D,R,S,D,S,R,D,L,R,U,R3',
  25: 'U,R,D,L,U,R,D,L2,U,R4,U2,L2,U,R,L,D,R2,D2,L4,D,R2,U,R3,U2,R3,U,L,D,R,U2,L,D,R,U,R,D,L',
  26: 'U2,L3,D,L3,D,R,U,R2,U2,R2,D,R2,D,R2,U2,L2,U,L6,D,L3,D3,S,U3,L6,D,L3,D3,U2,R,U,L,D,R,U,R2,U2,R2,D,R2,D,R2,U2,L2,U,L4,D5,R3,S,U3,L4,D5,R2,L',
  27: 'R5,U,L,D,R,U,R,D,L6,U,R,D,L2,U,R,D,R4,U,R4,D3,L,D3,L3,D,L,U4,R,D,L7,U,L,D2,R,U,L,D,R,U,L',
  28: 'L,D3,R,D,L,U,R,D2,R2,D2,R3,U3,L,U,L,U,L,U,L,D,R2,D,R,D,R,D,R2,D,L,D,L2,U3,L,U,L,U,L2,U,L2,D,L,U,R3,D,R,D,R,D,R,D,R,L4,D3,L5,U2,L3,D,S,L7,U2,L3,U',
  29: 'L,D,R,U,R2,D,L,U,R,D2,R2,L2,U2,L,D,R,U,L,D,L,U,L,U2,L2,R2,D2,R,D,R,U,R,D,L,U,R,U2,R2,L2,D6,R2,L2,U4,L,D,L,U,L,D,R,U,R5,L5,D,R,U,L2,D,R,U,L5,R5,U,L,D,L,D3,L3,U,R,D,L2,U,R,D2,L,U,R,D,R,U,L',
  30: 'D,R,D2,R2,U,R2,D,R4,U,D,L4,U,L3,D2,L,U,R6,U3,R3,U,R,D3,L2,D,L,D,R,U2,R,D,L,D,L4,U,L2,D,L2,U,L,D,L,U,R,U,D,L,D,R,U,R,D,R2,U,L,D2,L,U,R7,U,L,U3,R3,U,R,U,L5,D,L',
  31: 'U,L,D,L2,U4,D4,R3,U,L,D,R,U4,R,U,L,D2,L6,D,L,U,R2,D,L,U,R4,D3,L,D2,U2,R,U3,L4,U,R,D,L2,U,R,D2,L,U,R,D4,L,D,R,U2,L,D,R,U,L,D,R,L,D,R,U,L,D,R,U2,L,D,L,U,R4,U,R2,D,R3,U,L,D,R,U5,R,D,L',
  32: 'U2,L,D,R,U,R,U,R,D,L,R,U,L,D,L,D,L,U,R,D,L,U,R,U,R,U,R,D,L2,D4,L4,U,R,D,R3,U5,R,U,R2,U,D,L2,D,L,D5,L4,U,R,L,D,R4,U5,R,U,R2,U,D,L2,D,L,D5,L3,U,L,D,R4,U4,R2,U,L,D,L,D,L,D,R,U,L2,U,L5,D',
  33: 'R4,U,L,D3,R2,U,L,U,L,U2,R2,D,R,D,R,U,L2,U,R,D,R,D2,R,D,L,D2,R2,U,D,L2,U4,L,U,L,D,R,D,R,U,L,U,L3,D3,L,D,L2,D,L,U',
};

const _HINT_COLOR = { R: '#4a9eff', L: '#4a9eff', U: '#fbbf24', D: '#fbbf24', S: '#4ade80' };
const _HINT_BG    = {
  R: 'rgba(74,158,255,.15)', L: 'rgba(74,158,255,.15)',
  U: 'rgba(251,191,36,.15)', D: 'rgba(251,191,36,.15)',
  S: 'rgba(74,222,128,.15)',
};

function parseMoves(str) {
  const moves = [];
  const re = /([RLUDS])(\d*)/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    moves.push({ dir: m[1], count: parseInt(m[2] || '1', 10) });
  }
  return moves;
}

function showHint(level) {
  const movesEl = document.getElementById('hint-moves');
  const moveStr = OPTIMAL_MOVES[level];
  if (!moveStr) { movesEl.innerHTML = '<span style="color:var(--dim)">—</span>'; return; }
  movesEl.innerHTML = '';
  for (const { dir, count } of parseMoves(moveStr)) {
    const el = document.createElement('span');
    el.className = 'hint-move';
    el.style.color      = _HINT_COLOR[dir];
    el.style.background = _HINT_BG[dir];
    el.textContent = dir + (count > 1 ? count : '');
    movesEl.appendChild(el);
  }
}

// ── Screen management ─────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById('screen-' + id);
  if (el) el.classList.add('active');
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────
async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Best scores (localStorage) ────────────────────────────────────────────────
// Separate keys for player vs RL agent
function getBestPlay(num) {
  const v = localStorage.getItem(`bloxorz_play_${num}`);
  return v ? parseInt(v, 10) : null;
}
function trySetBestPlay(num, steps) {
  const cur = getBestPlay(num);
  if (cur === null || steps < cur) {
    localStorage.setItem(`bloxorz_play_${num}`, steps);
    return true;
  }
  return false;
}
function getBestAgent(num) {
  const v = localStorage.getItem(`bloxorz_agent_${num}`);
  return v ? parseInt(v, 10) : null;
}
function trySetBestAgent(num, steps) {
  const cur = getBestAgent(num);
  if (cur === null || steps < cur) {
    localStorage.setItem(`bloxorz_agent_${num}`, steps);
    return true;
  }
  return false;
}

// ── Intro ─────────────────────────────────────────────────────────────────────
function initIntro() {
  const word = 'BLOXORZ RL';
  const container = document.getElementById('intro-word');
  container.innerHTML = '';
  container.classList.remove('shimmering');
  [...word].forEach((ch, i) => {
    const span = document.createElement('span');
    span.className = 'intro-letter';
    span.textContent = ch;
    container.appendChild(span);
    setTimeout(() => span.classList.add('visible'), 80 + i * 85);
  });

  const sub = document.querySelector('.intro-sub');
  sub.classList.remove('visible');
  setTimeout(() => sub.classList.add('visible'), 1650);

  const pressKey = document.getElementById('press-key');
  pressKey.style.animation = 'none';
  void pressKey.offsetWidth;
  setTimeout(() => {
    pressKey.style.animation = 'blink 1.3s ease infinite';
  }, 2300);

  // Shimmer the title after letters settle
  setTimeout(() => container.classList.add('shimmering'), 2000);

  animateIntroBg();
}

// ── Landing-page background animation ─────────────────────────────────────────
let _introBgRafId = null;

function animateIntroBg() {
  // Cancel any previous loop so re-entering the intro restarts cleanly
  if (_introBgRafId) { cancelAnimationFrame(_introBgRafId); _introBgRafId = null; }

  const cvs = document.getElementById('intro-bg');

  function resize() {
    cvs.width  = window.innerWidth;
    cvs.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const ctx = cvs.getContext('2d');

  // Background projection — same aspect as the game but ~65 % scale
  const SCALE = 0.65;
  const bEX = EX * SCALE, bEY = EY * SCALE;
  const bSX = SX * SCALE, bSY = SY * SCALE;
  const bHZ = HZ * SCALE, bSLAB = Math.max(3, Math.round(SLAB * SCALE));

  // Virtual tile grid
  const GROW = 22, GCOL = 28;

  // Tile palette variety (seeded per-cell, stable)
  const palRng = _seededRng(0xbeef);
  const cellPal = Array.from({ length: GROW * GCOL }, () => {
    const v = palRng();
    if (v < 0.07) return PAL[TILE.SOFT_SW];
    if (v < 0.17) return PAL[TILE.FRAGILE];
    return PAL[TILE.SOLID];
  });

  // Depth-sorted tile draw order (static)
  const tileOrder = [];
  for (let r = 0; r < GROW; r++)
    for (let c = 0; c < GCOL; c++)
      tileOrder.push({ r, c, depth: r + c * 0.4 });
  tileOrder.sort((a, b) => a.depth - b.depth);

  // Background block physics table
  const BG_PHY = [
    [{o:1,dr:-2,dc:0},{o:2,dr:0,dc:1},{o:1,dr:1,dc:0},{o:2,dr:0,dc:-2}],
    [{o:0,dr:-1,dc:0},{o:1,dr:0,dc:1},{o:0,dr:2,dc:0},{o:1,dr:0,dc:-1}],
    [{o:2,dr:-1,dc:0},{o:0,dr:0,dc:2},{o:2,dr:1,dc:0},{o:0,dr:0,dc:-1}],
  ];

  // Three roaming blocks
  const bgBlocks = [
    { r:5,  c:8,  o:0, anim:null, nextT:90  },
    { r:11, c:15, o:1, anim:null, nextT:140 },
    { r:4,  c:21, o:0, anim:null, nextT:60  },
  ];

  function tryMoveBgBlock(blk) {
    const dirs = [0,1,2,3].sort(() => Math.random() - 0.5);
    for (const act of dirs) {
      const mv = BG_PHY[blk.o][act];
      const nr = blk.r + mv.dr, nc = blk.c + mv.dc;
      if (nr < 0 || nc < 0) continue;
      if (mv.o === 0 && (nr >= GROW || nc >= GCOL)) continue;
      if (mv.o === 1 && (nr + 1 >= GROW || nc >= GCOL)) continue;
      if (mv.o === 2 && (nr >= GROW || nc + 1 >= GCOL)) continue;
      blk.anim = { fromR:blk.r, fromC:blk.c, fromO:blk.o, dir:act, progress:0 };
      blk.r = nr; blk.c = nc; blk.o = mv.o;
      return;
    }
    // No valid move — just wait longer
    blk.nextT += 30;
  }

  let t = 0;

  function frame() {
    if (!document.getElementById('screen-intro').classList.contains('active')) {
      _introBgRafId = null; return;
    }
    t++;
    const W = cvs.width, H = cvs.height;
    ctx.clearRect(0, 0, W, H);

    // Stars layer
    ctx.globalAlpha = 0.55;
    _drawStars(ctx, W, H, t * 16);
    ctx.globalAlpha = 1;

    // Grid origin — shifted so tiles fill the lower-right quadrant nicely
    const ox = W * 0.54 + 55;
    const oy = H * 0.58 + 35;

    function w2s(wx, wy, wz) {
      return {
        x: ox + wx * bEX + wy * bSX,
        y: oy + wx * bEY + wy * bSY - wz * bHZ,
      };
    }

    // Diagonal wave of brightness sweeping across the grid
    const wavePos = (t * 0.016) % (GROW + GCOL);

    // Draw tiles
    for (const { r, c } of tileOrder) {
      const cols = cellPal[r * GCOL + c];

      // Wave glow
      const waveDist = Math.abs(r + c - wavePos);
      const wave = Math.exp(-waveDist * 0.35) * 0.20;

      // Per-tile bobbing
      const wz = Math.sin(t * 0.009 + (r * 2.1 + c * 1.7) * 0.42) * 0.3;

      const NW=w2s(c,r,wz), NE=w2s(c+1,r,wz), SE=w2s(c+1,r+1,wz), SW=w2s(c,r+1,wz);

      // Coarse cull
      if (SE.x < -60 || NW.x > W + 60 || SW.y + bSLAB < -60 || NE.y > H + 60) continue;

      ctx.globalAlpha = 0.16 + wave;
      // South face
      ctx.fillStyle = cols[1];
      ctx.beginPath(); ctx.moveTo(SW.x,SW.y); ctx.lineTo(SE.x,SE.y);
      ctx.lineTo(SE.x,SE.y+bSLAB); ctx.lineTo(SW.x,SW.y+bSLAB); ctx.closePath(); ctx.fill();
      // East face
      ctx.fillStyle = cols[2];
      ctx.beginPath(); ctx.moveTo(NE.x,NE.y); ctx.lineTo(SE.x,SE.y);
      ctx.lineTo(SE.x,SE.y+bSLAB); ctx.lineTo(NE.x,NE.y+bSLAB); ctx.closePath(); ctx.fill();
      // Top face
      ctx.fillStyle = cols[0];
      ctx.beginPath(); ctx.moveTo(NW.x,NW.y); ctx.lineTo(NE.x,NE.y);
      ctx.lineTo(SE.x,SE.y); ctx.lineTo(SW.x,SW.y); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Advance and draw roaming blocks
    for (const blk of bgBlocks) {
      if (blk.anim) {
        blk.anim.progress += 1 / 36;
        if (blk.anim.progress >= 1) {
          blk.anim = null;
          blk.nextT = t + 28 + Math.floor(Math.random() * 50);
        }
      } else if (t >= blk.nextT) {
        tryMoveBgBlock(blk);
      }

      let corners;
      if (blk.anim) {
        const { fromR, fromC, fromO, dir, progress } = blk.anim;
        const te = easeInOut(Math.min(1, progress));
        const bc = blockCorners(fromR, fromC, fromO);
        const params = animParams(fromR, fromC, fromO, dir);
        corners = params ? transformCorners(bc, params, te) : bc;
      } else {
        corners = blockCorners(blk.r, blk.c, blk.o);
      }

      ctx.save();
      ctx.shadowColor = '#ff5555';
      ctx.shadowBlur  = 22;
      ctx.globalAlpha = 0.70;
      drawBlockFacesCustom(ctx, corners, w2s);
      ctx.restore();
    }

    // Vignette — dark radial gradient pulls focus to the centre title
    const vg = ctx.createRadialGradient(W/2, H*0.44, H*0.10, W/2, H*0.44, H*0.72);
    vg.addColorStop(0, 'rgba(4,4,16,0)');
    vg.addColorStop(1, 'rgba(4,4,16,0.65)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    _introBgRafId = requestAnimationFrame(frame);
  }

  _introBgRafId = requestAnimationFrame(frame);
}

// ── Next-level button ─────────────────────────────────────────────────────────
function updateNextLevelBtn(num) {
  const btn = document.getElementById('btn-next-level');
  const hasNext = App.levels.some(l => l.num === num + 1);
  btn.style.display = hasNext ? '' : 'none';
}

// ── Home / intro navigation ───────────────────────────────────────────────────
function goHome() {
  stopRenderLoop();
  stopWatchTimer();
  App.fallAnim        = null;
  App.edgeFallAnim    = null;
  App.flashColor      = null;
  App.splitSwitchAnim = null;
  App.splitEntryAnim  = null;
  App.hintVisible     = false;
  document.getElementById('result-overlay').classList.remove('show');
  document.getElementById('hint-overlay').classList.remove('visible');
  document.getElementById('btn-hint').style.display = 'none';
  App.resultShown = false;
  showScreen('intro');
  initIntro();
}

// ── Level select ──────────────────────────────────────────────────────────────
async function showLevelSelect() {
  stopRenderLoop();
  stopWatchTimer();
  showScreen('select');

  if (!App.levelDataLoaded) {
    App.levelDataLoaded = true;
    try {
      const [lvlData, ckptData] = await Promise.all([
        api('/api/levels'),
        api('/api/checkpoints'),
      ]);
      App.levels      = lvlData.levels;
      App.checkpoints = ckptData.checkpoints;
      // Compute arena reference from the largest level so all levels share the same tile scale
      if (App.levels.length) {
        let maxH = 0, maxW = 0;
        for (const lvl of App.levels) {
          maxH = Math.max(maxH, lvl.grid.length);
          maxW = Math.max(maxW, lvl.grid[0].length);
        }
        setArenaRef(maxH, maxW);
      }
    } catch (e) {
      console.error('Failed to load level data:', e);
    }
  }

  buildLevelGrid();
}

function buildLevelGrid() {
  const grid = document.getElementById('level-grid');
  grid.innerHTML = '';

  for (const lvl of App.levels) {
    const hasCkpt   = !!(App.checkpoints[lvl.num]?.length);
    const isLocked  = App.mode === 'watch' && !hasCkpt;
    const playDone  = getBestPlay(lvl.num) !== null;
    const agentDone = getBestAgent(lvl.num) !== null;

    const card = document.createElement('div');
    const classes = ['card'];
    if (isLocked)  classes.push('locked');
    if (playDone)  classes.push('play-done');
    if (agentDone) classes.push('ai-done');
    card.className = classes.join(' ');

    const thumb = document.createElement('canvas');
    thumb.className = 'card-thumb';
    card.appendChild(thumb);
    renderThumbnail(thumb, lvl);

    // Completion badges — always visible, one per completion type
    if (playDone || agentDone) {
      const badges = document.createElement('div');
      badges.className = 'card-badges';
      if (playDone) {
        const b = document.createElement('span');
        b.className = 'card-badge badge-play';
        b.textContent = '✓ CLEARED';
        badges.appendChild(b);
      }
      if (agentDone) {
        const b = document.createElement('span');
        b.className = 'card-badge badge-ai';
        b.textContent = '⚡ AI SOLVED';
        badges.appendChild(b);
      }
      card.appendChild(badges);
    }

    const body = document.createElement('div');
    body.className = 'card-body';

    const numEl = document.createElement('div');
    numEl.className = 'card-num';
    numEl.textContent = `LEVEL ${String(lvl.num).padStart(2, '0')}`;
    body.appendChild(numEl);

    // Show play best in play mode, agent best in watch mode
    const movesEl = document.createElement('div');
    const bestVal = App.mode === 'play' ? getBestPlay(lvl.num) : getBestAgent(lvl.num);
    if (bestVal !== null) {
      movesEl.className   = 'card-moves solved';
      movesEl.textContent = `BEST: ${bestVal} MOVES`;
    } else {
      movesEl.className   = 'card-moves';
      movesEl.textContent = isLocked ? 'NO CHECKPOINT' : 'NOT SOLVED';
    }
    body.appendChild(movesEl);
    card.appendChild(body);
    grid.appendChild(card);

    if (!isLocked) card.addEventListener('click', () => startLevel(lvl.num));
  }
}

// ── Level transition ──────────────────────────────────────────────────────────
function playTransition(num, callback) {
  showScreen('transition');
  const inner = document.getElementById('trans-inner');
  document.getElementById('trans-num').textContent = String(num).padStart(2, '0');

  inner.className = 'trans-inner';
  void inner.offsetWidth;
  inner.classList.add('in');

  setTimeout(() => {
    inner.classList.remove('in');
    inner.classList.add('out');
    setTimeout(callback, 460);
  }, 900);
}

// ── Start level ───────────────────────────────────────────────────────────────
async function startLevel(num) {
  App.currentLevel = num;
  App.resultShown  = false;
  App.flashColor   = null;
  App.bridgeAnims  = [];
  stopWatchTimer();
  stopRenderLoop();

  playTransition(num, async () => {
    showScreen('game');
    document.getElementById('hud-level').textContent =
      `LEVEL ${String(num).padStart(2, '0')}`;
    refreshBestHud(num);
    updateNextLevelBtn(num);
    document.getElementById('result-overlay').classList.remove('show');

    if (App.mode === 'play') await startPlayMode(num);
    else                      await startWatchMode(num);
  });
}

function refreshBestHud(num) {
  const playBest  = getBestPlay(num);
  const bestEl    = document.getElementById('hud-best');
  if (playBest !== null) {
    bestEl.textContent = String(playBest);
    bestEl.classList.remove('dim');
  } else {
    bestEl.textContent = '--';
    bestEl.classList.add('dim');
  }

  const agentBest  = getBestAgent(num);
  const agentEl    = document.getElementById('hud-agent-best');
  if (agentBest !== null) {
    agentEl.textContent = String(agentBest);
    agentEl.classList.remove('dim');
  } else {
    agentEl.textContent = '--';
    agentEl.classList.add('dim');
  }
}

// ── PLAY MODE ─────────────────────────────────────────────────────────────────
async function startPlayMode(num) {
  App.fallAnim        = null;
  App.edgeFallAnim    = null;
  App.flashColor      = null;
  App.splitSwitchAnim = null;
  App.splitEntryAnim  = null;
  App.hintVisible     = false;
  document.getElementById('watch-bar').classList.remove('visible');
  document.getElementById('hint-overlay').classList.remove('visible');
  document.getElementById('btn-hint').classList.remove('hint-active');
  document.getElementById('btn-hint').style.display = '';
  document.getElementById('hud-steps').textContent = '0';

  try {
    const state = await api(`/api/play/start?level=${num}`, { method: 'POST' });
    App.sessionId = state.session_id;
    App.gameState = state;
    App.anim      = null;
    App.bridgeAnims = [];
    startRenderLoop();
  } catch (e) {
    console.error('startPlayMode failed:', e);
  }
}

async function sendAction(action) {
  if (App.mode !== 'play') return;
  if (!App.sessionId)      return;
  if (App.resultShown)     return;
  if (App.anim && App.anim.progress < 1) return;

  const prevState  = App.gameState;
  const prevSplit  = prevState.split;
  const fromBlock  = prevState.block ? { ...prevState.block } : null;
  const oldBridges = prevState.bridges ? [...prevState.bridges] : [];

  try {
    const state = await api(
      `/api/play/${App.sessionId}/step?action=${action}`,
      { method: 'POST' }
    );

    const now = performance.now();

    // Detect bridge state changes and start slide animations
    if (state.bridges) {
      for (let i = 0; i < state.bridges.length; i++) {
        if (i < oldBridges.length && oldBridges[i] !== state.bridges[i]) {
          App.bridgeAnims.push({
            bridgeIdx:  i,
            opening:    state.bridges[i],
            t:          0,
            startMs:    now,
            durationMs: BRIDGE_ANIM_MS,
          });
        }
      }
    }

    if (!prevSplit && state.split) {
      // Normal → split: roll block to the trigger tile, then burst open
      App.splitSwitchAnim = null;
      App.anim = { fromBlock, action, progress: 0, startMs: now, durationMs: ANIM_MS };
      App.splitEntryAnim = {
        startMs:    now + ANIM_MS,   // starts the moment the roll finishes
        durationMs: 620,
        triggerR:   state.block.r,   // block stops on the split tile
        triggerC:   state.block.c,
        subA: { r: state.split.sub_a.r, c: state.split.sub_a.c },
        subB: { r: state.split.sub_b.r, c: state.split.sub_b.c },
      };
    } else if (prevSplit && !state.split) {
      // Split → normal (recombination): roll active sub into the merge position
      const movingSub     = prevSplit.active === 0 ? prevSplit.sub_a : prevSplit.sub_b;
      const stationarySub = prevSplit.active === 0 ? prevSplit.sub_b : prevSplit.sub_a;
      App.splitSwitchAnim = null;
      App.splitEntryAnim  = null;
      App.anim = {
        fromBlock:   { r: movingSub.r,     c: movingSub.c,     orientation: 0 },
        activeSub:   prevSplit.active,
        inactiveSub: { r: stationarySub.r, c: stationarySub.c },
        action,
        progress:   0,
        startMs:    now,
        durationMs: ANIM_MS,
        isMerge:    true,
      };
      setTimeout(() => {
        App.flashColor = '#66ffcc';
        App.flashUntil = performance.now() + 180;
      }, ANIM_MS);
    } else if (prevSplit && action === ACT.SWITCH) {
      // Switch sub-block: flash newly active, no movement anim
      App.anim = null;
      App.splitEntryAnim  = null;
      App.splitSwitchAnim = { startMs: now, durationMs: SWITCH_ANIM_MS };
    } else if (prevSplit) {
      // Move in split mode: roll the active sub-block
      const fromSub = prevSplit.active === 0 ? prevSplit.sub_a : prevSplit.sub_b;
      App.splitSwitchAnim = null;
      App.splitEntryAnim  = null;
      App.anim = {
        fromBlock: { r: fromSub.r, c: fromSub.c, orientation: 0 },
        activeSub: prevSplit.active,
        action,
        progress:  0,
        startMs:   now,
        durationMs: ANIM_MS,
      };
    } else {
      // Normal mode: rolling animation
      App.splitSwitchAnim = null;
      App.splitEntryAnim  = null;
      App.anim = { fromBlock, action, progress: 0, startMs: now, durationMs: ANIM_MS };
    }

    App.gameState = state;
    document.getElementById('hud-steps').textContent = String(state.steps);

    if (state.done) {
      App.sessionId = null;
      if (state.won) {
        App.flashColor = '#44ff88';
        App.flashUntil = performance.now() + ANIM_MS + 180;
        setTimeout(() => {
          App.fallAnim = {
            startMs:     performance.now(),
            durationMs:  560,
            resultState: state,
          };
        }, ANIM_MS + 40);
      } else {
        // For SWITCH, no roll anim to wait for — shorter delay
        const animDelay = (prevSplit && action === ACT.SWITCH) ? 60 : ANIM_MS + 40;
        setTimeout(() => {
          App.edgeFallAnim = { startMs: performance.now(), durationMs: 750, resultState: state, action };
        }, animDelay);
      }
    }
  } catch (e) {
    console.error('sendAction failed:', e);
    App.sessionId = null;
    startPlayMode(App.currentLevel);
  }
}

// ── WATCH MODE ────────────────────────────────────────────────────────────────
async function startWatchMode(num) {
  const ckpts = App.checkpoints[num];
  if (!ckpts?.length) return;

  document.getElementById('watch-bar').classList.add('visible');
  document.getElementById('hint-overlay').classList.remove('visible');
  document.getElementById('btn-hint').style.display = 'none';
  App.hintVisible     = false;
  App.watchPlaying    = false;
  App.watchIdx        = 0;
  App.watchStates     = [];
  App.bridgeAnims     = [];
  App.edgeFallAnim    = null;
  App.splitSwitchAnim = null;
  App.splitEntryAnim  = null;
  document.getElementById('w-play').textContent = '▶';
  document.getElementById('hud-steps').textContent = '0';

  try {
    const ck   = ckpts[0];
    const data = await api(`/api/watch/${num}?checkpoint=${encodeURIComponent(ck.path)}`);
    App.watchStates = data.states;
    App.gameState   = App.watchStates[0];
    App.anim        = null;

    const scrub = document.getElementById('w-scrub');
    scrub.max   = App.watchStates.length - 1;
    scrub.value = 0;
    document.getElementById('w-tot').textContent = App.watchStates.length - 1;
    updateWatchUI();
    startRenderLoop();

    setTimeout(startWatchPlayback, 600);
  } catch (e) {
    console.error('startWatchMode failed:', e);
  }
}

function startWatchPlayback() {
  if (App.watchIdx >= App.watchStates.length - 1) {
    App.watchIdx        = 0;
    App.gameState       = App.watchStates[0];
    App.anim            = null;
    App.splitSwitchAnim = null;
    App.bridgeAnims     = [];
    updateWatchUI();
  }
  App.watchPlaying = true;
  document.getElementById('w-play').textContent = '⏸';
  scheduleNextWatchStep();
}

function scheduleNextWatchStep() {
  stopWatchTimer();
  if (!App.watchPlaying) return;
  if (App.watchIdx >= App.watchStates.length - 1) {
    App.watchPlaying = false;
    document.getElementById('w-play').textContent = '▶';
    const last = App.watchStates[App.watchStates.length - 1];
    if (last.done) {
      if (last.won) {
        App.flashColor = '#44ff88';
        App.flashUntil = performance.now() + 400;
        setTimeout(() => {
          App.fallAnim = {
            startMs:     performance.now(),
            durationMs:  560,
            resultState: last,
          };
        }, Math.round(ANIM_MS / App.watchSpeed) + 40);
      } else {
        setTimeout(() => {
          App.edgeFallAnim = { startMs: performance.now(), durationMs: 750, resultState: last, action: last.action };
        }, 60);
      }
    }
    return;
  }

  const from = App.watchStates[App.watchIdx];
  App.watchIdx++;
  const to = App.watchStates[App.watchIdx];
  App.gameState = to;

  const dur = ANIM_MS / App.watchSpeed;

  // Detect bridge transitions
  if (from.bridges && to.bridges) {
    const now = performance.now();
    for (let i = 0; i < from.bridges.length; i++) {
      if (i < to.bridges.length && from.bridges[i] !== to.bridges[i]) {
        App.bridgeAnims.push({
          bridgeIdx:  i,
          opening:    to.bridges[i],
          t:          0,
          startMs:    now,
          durationMs: BRIDGE_ANIM_MS / App.watchSpeed,
        });
      }
    }
  }

  if (to.action !== null && to.action !== undefined) {
    const fromSplit = from.split;
    if (fromSplit && to.action === ACT.SWITCH) {
      App.anim = null;
      App.splitSwitchAnim = { startMs: performance.now(), durationMs: SWITCH_ANIM_MS / App.watchSpeed };
    } else if (fromSplit) {
      const fromSub = fromSplit.active === 0 ? fromSplit.sub_a : fromSplit.sub_b;
      App.anim = {
        fromBlock: { r: fromSub.r, c: fromSub.c, orientation: 0 },
        activeSub: fromSplit.active,
        action:    to.action,
        progress:  0,
        startMs:   performance.now(),
        durationMs: dur,
      };
    } else {
      App.anim = {
        fromBlock:  from.block ? { ...from.block } : null,
        action:     to.action,
        progress:   0,
        startMs:    performance.now(),
        durationMs: dur,
      };
    }
  } else {
    App.anim = null;
    App.splitSwitchAnim = null;
  }

  document.getElementById('hud-steps').textContent = String(to.steps);
  updateWatchUI();

  App.watchTimer = setTimeout(scheduleNextWatchStep, dur + 30);
}

function stopWatchTimer() {
  if (App.watchTimer) { clearTimeout(App.watchTimer); App.watchTimer = null; }
}

function updateWatchUI() {
  document.getElementById('w-cur').textContent   = App.watchIdx;
  document.getElementById('w-scrub').value       = App.watchIdx;
}

function watchJumpTo(idx) {
  stopWatchTimer();
  App.watchPlaying    = false;
  document.getElementById('w-play').textContent = '▶';
  App.watchIdx        = Math.max(0, Math.min(idx, App.watchStates.length - 1));
  App.gameState       = App.watchStates[App.watchIdx];
  App.anim            = null;
  App.splitSwitchAnim = null;
  App.splitEntryAnim  = null;
  App.bridgeAnims     = [];
  document.getElementById('hud-steps').textContent = String(App.gameState.steps);
  updateWatchUI();
}

// ── Result overlay ────────────────────────────────────────────────────────────
function showResult(state) {
  if (App.resultShown) return;
  App.resultShown = true;

  const textEl = document.getElementById('result-text');
  const subEl  = document.getElementById('result-sub');
  const actEl  = document.getElementById('result-actions');

  if (state.won) {
    textEl.textContent = 'SOLVED';
    textEl.className   = 'result-text win';
    let isNew;
    if (App.mode === 'play') {
      isNew = trySetBestPlay(App.currentLevel, state.steps);
    } else {
      isNew = trySetBestAgent(App.currentLevel, state.steps);
    }
    subEl.textContent = `IN ${state.steps} MOVES${isNew ? '  ·  NEW BEST!' : ''}`;
    App.flashColor    = '#44ff88';
    refreshBestHud(App.currentLevel);
  } else {
    textEl.textContent = 'FELL';
    textEl.className   = 'result-text fell';
    subEl.textContent  = `ON MOVE ${state.steps}`;
    App.flashColor     = '#ff4422';
  }
  App.flashUntil = performance.now() + 350;

  actEl.innerHTML = '';
  if (App.mode === 'play') {
    if (state.won) {
      const nextNum = App.currentLevel + 1;
      const hasNext = App.levels.some(l => l.num === nextNum);
      if (hasNext) {
        actEl.appendChild(makeBtn('← LEVELS', '',        () => { hideResult(); showLevelSelect(); }));
        actEl.appendChild(makeBtn('↺ RETRY',  '',        () => { hideResult(); startPlayMode(App.currentLevel); }));
        actEl.appendChild(makeBtn('NEXT →',   'primary', () => { hideResult(); startLevel(nextNum); }));
      } else {
        actEl.appendChild(makeBtn('↺ RETRY',  'primary', () => { hideResult(); startPlayMode(App.currentLevel); }));
        actEl.appendChild(makeBtn('← LEVELS', '',        () => { hideResult(); showLevelSelect(); }));
      }
    } else {
      actEl.appendChild(makeBtn('← LEVELS', '',        () => { hideResult(); showLevelSelect(); }));
      actEl.appendChild(makeBtn('↺ RETRY',  'primary', () => { hideResult(); startPlayMode(App.currentLevel); }));
    }
  } else {
    actEl.appendChild(makeBtn('▶ REPLAY', 'primary', () => { hideResult(); startWatchMode(App.currentLevel); }));
    actEl.appendChild(makeBtn('← LEVELS', '',        () => { hideResult(); showLevelSelect(); }));
  }

  document.getElementById('result-overlay').classList.add('show');
}

function hideResult() {
  App.resultShown  = false;
  App.flashColor   = null;
  App.fallAnim     = null;
  App.edgeFallAnim = null;
  document.getElementById('result-overlay').classList.remove('show');
}

function makeBtn(label, cls, onClick) {
  const el      = document.createElement('button');
  el.className  = 'ra-btn' + (cls ? ' ' + cls : '');
  el.textContent = label;
  el.addEventListener('click', onClick);
  return el;
}

// ── Render loop ───────────────────────────────────────────────────────────────
function startRenderLoop() {
  if (App.rafId) return;
  App.rafId = requestAnimationFrame(renderLoop);
}

function stopRenderLoop() {
  if (App.rafId) { cancelAnimationFrame(App.rafId); App.rafId = null; }
}

function renderLoop(now) {
  App.rafId = null;
  if (!document.getElementById('screen-game').classList.contains('active')) return;

  App.glowTime = now;

  // Resolve flash
  let flash = null;
  if (App.flashColor && now < App.flashUntil) flash = App.flashColor;
  else App.flashColor = null;

  // Tick block animation
  if (App.anim) {
    App.anim.progress = (now - App.anim.startMs) / App.anim.durationMs;
    if (App.anim.progress >= 1) App.anim = null;
  }

  // Tick switch-flash animation
  let splitSwitchT = 0;
  if (App.splitSwitchAnim) {
    splitSwitchT = Math.min(1, (now - App.splitSwitchAnim.startMs) / App.splitSwitchAnim.durationMs);
    if (splitSwitchT >= 1) App.splitSwitchAnim = null;
  }

  // Tick split-entry animation (negative t = roll phase; >= 0 = burst/fly phase)
  let splitEntry = null;
  if (App.splitEntryAnim) {
    const ea = App.splitEntryAnim;
    const elapsed = now - ea.startMs;
    if (elapsed >= ea.durationMs) {
      App.splitEntryAnim = null;
    } else {
      splitEntry = { t: elapsed / ea.durationMs, ...ea };
    }
  }

  // Tick bridge animations
  App.bridgeAnims = App.bridgeAnims.filter(ba => {
    ba.t = Math.min(1, (now - ba.startMs) / ba.durationMs);
    return ba.t < 1;
  });

  // Tick win fall-through animation
  let fallProgress = 0;
  if (App.fallAnim) {
    const elapsed = now - App.fallAnim.startMs;
    fallProgress = Math.min(1, elapsed / App.fallAnim.durationMs);
    if (elapsed >= App.fallAnim.durationMs && !App.resultShown) {
      showResult(App.fallAnim.resultState);
      // Keep App.fallAnim alive at progress=1 so block stays invisible in goal
      // until hideResult() clears it
    }
  }

  // Tick fail edge-fall animation
  let edgeFall = null;
  if (App.edgeFallAnim) {
    const elapsed  = now - App.edgeFallAnim.startMs;
    const progress = Math.min(1, elapsed / App.edgeFallAnim.durationMs);
    edgeFall = { progress, action: App.edgeFallAnim.action };
    if (elapsed >= App.edgeFallAnim.durationMs && !App.resultShown) {
      showResult(App.edgeFallAnim.resultState);
      // Keep App.edgeFallAnim alive at progress=1 so block stays invisible
      // until hideResult() clears it
    }
  }

  const canvas = document.getElementById('game-canvas');
  const wrap   = document.getElementById('game-wrap');
  fitCanvas(canvas, wrap);
  if (App.gameState) {
    renderGame(canvas, App.gameState, App.anim, App.glowTime, flash,
               App.bridgeAnims.length ? App.bridgeAnims : null, fallProgress, edgeFall, splitSwitchT, splitEntry);
  }

  App.rafId = requestAnimationFrame(renderLoop);
}

// ── Keyboard ──────────────────────────────────────────────────────────────────
const KEY_MAP = {
  ArrowUp:0,    KeyW:0,
  ArrowRight:1, KeyD:1,
  ArrowDown:2,  KeyS:2,
  ArrowLeft:3,  KeyA:3,
};

document.addEventListener('keydown', e => {
  const active = document.querySelector('.screen.active')?.id;

  if (active === 'screen-intro') {
    showLevelSelect();
    return;
  }

  if (active !== 'screen-game') return;

  if (App.mode === 'play') {
    if (e.code in KEY_MAP) { e.preventDefault(); sendAction(KEY_MAP[e.code]); return; }
    if (e.code === 'Space') { e.preventDefault(); sendAction(ACT.SWITCH); return; }
    if (e.code === 'KeyR')  { startPlayMode(App.currentLevel); return; }
  }

  if (App.mode === 'watch') {
    if (e.code === 'Space') {
      e.preventDefault();
      if (App.watchPlaying) {
        stopWatchTimer(); App.watchPlaying = false;
        document.getElementById('w-play').textContent = '▶';
      } else {
        startWatchPlayback();
      }
    }
    if (e.code === 'ArrowRight') watchJumpTo(App.watchIdx + 1);
    if (e.code === 'ArrowLeft')  watchJumpTo(App.watchIdx - 1);
  }
});

// ── Button wiring ─────────────────────────────────────────────────────────────
document.getElementById('btn-hint').addEventListener('click', () => {
  App.hintVisible = !App.hintVisible;
  const overlay = document.getElementById('hint-overlay');
  const btn     = document.getElementById('btn-hint');
  if (App.hintVisible) {
    showHint(App.currentLevel);
    overlay.classList.add('visible');
    btn.classList.add('hint-active');
    btn.textContent = '? HINT ON';
  } else {
    overlay.classList.remove('visible');
    btn.classList.remove('hint-active');
    btn.textContent = '? HINT';
  }
});

document.getElementById('btn-restart').addEventListener('click', () => {
  hideResult();
  stopWatchTimer();
  if (App.mode === 'play') startPlayMode(App.currentLevel);
  else                      startWatchMode(App.currentLevel);
});

document.getElementById('btn-levels').addEventListener('click', () => {
  hideResult();
  showLevelSelect();
});

document.getElementById('btn-home').addEventListener('click', goHome);
document.getElementById('btn-next-level').addEventListener('click', () => {
  hideResult();
  startLevel(App.currentLevel + 1);
});
document.getElementById('header-logo').addEventListener('click', goHome);

document.getElementById('tab-play').addEventListener('click', () => {
  App.mode = 'play';
  document.getElementById('tab-play').classList.add('active');
  document.getElementById('tab-watch').classList.remove('active');
  buildLevelGrid();
});
document.getElementById('tab-watch').addEventListener('click', () => {
  App.mode = 'watch';
  document.getElementById('tab-watch').classList.add('active');
  document.getElementById('tab-play').classList.remove('active');
  buildLevelGrid();
});

document.getElementById('w-play').addEventListener('click', () => {
  if (!App.watchPlaying) startWatchPlayback();
  else { stopWatchTimer(); App.watchPlaying=false; document.getElementById('w-play').textContent='▶'; }
});
document.getElementById('w-prev').addEventListener('click', () => watchJumpTo(App.watchIdx - 1));
document.getElementById('w-next').addEventListener('click', () => watchJumpTo(App.watchIdx + 1));
document.getElementById('w-scrub').addEventListener('input', e =>
  watchJumpTo(parseInt(e.target.value, 10)));
document.getElementById('w-speed').addEventListener('input', e => {
  App.watchSpeed = parseFloat(e.target.value);
  document.getElementById('w-speed-val').textContent = App.watchSpeed + '×';
});

// Intro click-through
document.getElementById('screen-intro').addEventListener('click', () => showLevelSelect());

// Resize
window.addEventListener('resize', () => {
  const cvs = document.getElementById('game-canvas');
  if (cvs && App.gameState) fitCanvas(cvs, document.getElementById('game-wrap'));
});

// ── Boot ──────────────────────────────────────────────────────────────────────
initIntro();
