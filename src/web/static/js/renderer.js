// ── Projection constants ──────────────────────────────────────────────────────
// Oblique parallel projection: front-facing Bloxorz style.
// wx = column (east), wy = row (south), wz = height (up)
const EX = 52, EY = 10;    // wx (column) → screen x, y
const SX = -22, SY = 28;   // wy (row)    → screen x, y
const HZ = 30;              // wz (height) → screen y (upward = negative)
const SLAB = 9;             // tile side-face pixel height
const PAD = 44;

// Camera from-scene direction: cx*EX + cy*SX = 0 → cx = -SX/EX
const _cx = -SX / EX;                    // ≈ 0.423
const _cz = (_cx * EY + SY) / HZ;        // ≈ 1.454
const CAM = [_cx, 1, _cz];

// Column weight in depth ordering (painter's algorithm)
const DEPTH_K = _cx;   // ≈ 0.423

const TILE  = { VOID:0, START:1, GOAL:2, SOLID:3, FRAGILE:4, SOFT_SW:5, HARD_SW:6, BRIDGE:7, TELE:8, SPLIT:9 };
const ORIENT = { STAND:0, FLAT_V:1, FLAT_H:2 };
const ACT   = { N:0, E:1, S:2, W:3, SWITCH:4 };

// Tile color palettes: [top, south/front-face, east/right-face]
const PAL = {
  [TILE.START]:   ['#7ab4d8', '#2460a0', '#0e3465'],
  [TILE.GOAL]:    ['#020205', '#3d2800', '#2a1c00'],   // near-black top, dark gold sides
  [TILE.SOLID]:   ['#7ab4d8', '#2460a0', '#0e3465'],
  [TILE.FRAGILE]: ['#fb923c', '#c2410c', '#9a3412'],
  [TILE.SOFT_SW]: ['#7ab4d8', '#2460a0', '#0e3465'],
  [TILE.HARD_SW]: ['#7ab4d8', '#2460a0', '#0e3465'],
  bridge_on:      ['#c4b5fd', '#7c3aed', '#4c1d95'],
  [TILE.TELE]:    ['#a5b4fc', '#4f46e5', '#312e81'],
  [TILE.SPLIT]:   ['#7ab4d8', '#2460a0', '#0e3465'],   // same sandstone base as switches
  fragile_broken: ['#110500', '#0c0300', '#060100'],
};

// Block colours — warm sandstone with mortar joints
const BLK = { top: '#e0b060', south: '#a06020', east: '#5a3010' };

// Face definitions: corner indices + outward normal direction
// Corners: 0-3 = bottom ring, 4-7 = top ring
// Per ring: NW(0/4), NE(1/5), SE(2/6), SW(3/7)
const FACES = [
  { name:'TOP',    idx:[4,5,6,7] },
  { name:'BOTTOM', idx:[3,2,1,0] },
  { name:'NORTH',  idx:[0,1,5,4] },
  { name:'SOUTH',  idx:[3,7,6,2] },
  { name:'WEST',   idx:[0,4,7,3] },
  { name:'EAST',   idx:[1,2,6,5] },
];

// ── Math helpers ──────────────────────────────────────────────────────────────
function cross(a, b) {
  return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
}
function dot(a, b) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function len(a)    { return Math.sqrt(a[0]**2+a[1]**2+a[2]**2); }
function norm(a)   { const l=len(a)||1; return [a[0]/l,a[1]/l,a[2]/l]; }
function easeInOut(t) { return t<.5?2*t*t:-1+(4-2*t)*t; }

// ── Arena reference (set once from the max level dimensions after levels load) ─
let _refH = 0, _refW = 0;
function setArenaRef(H, W) { _refH = H; _refW = W; }

// ── Projection ────────────────────────────────────────────────────────────────
let _ox = 0, _oy = 0;

function w2s(wx, wy, wz, ox, oy) {
  return {
    x: ox + wx*EX + wy*SX,
    y: oy + wx*EY + wy*SY - wz*HZ,
  };
}

// ── Depth helpers ─────────────────────────────────────────────────────────────
function tileDepth(r, c) { return r + c * DEPTH_K; }

function blockDepthKey(r, c, orientation) {
  if (orientation === ORIENT.FLAT_V) return r + 1 + c * DEPTH_K;
  if (orientation === ORIENT.FLAT_H) return r + (c + 1) * DEPTH_K;
  return r + c * DEPTH_K;
}

// ── Block geometry ────────────────────────────────────────────────────────────
function blockCorners(r, c, orientation) {
  let wxn, wxx, wyn, wyx, wzx;
  switch (orientation) {
    case ORIENT.STAND:  wxn=c; wxx=c+1; wyn=r; wyx=r+1; wzx=2; break;
    case ORIENT.FLAT_V: wxn=c; wxx=c+1; wyn=r; wyx=r+2; wzx=1; break;
    case ORIENT.FLAT_H: wxn=c; wxx=c+2; wyn=r; wyx=r+1; wzx=1; break;
  }
  return [
    [wxn,wyn,0],[wxx,wyn,0],[wxx,wyx,0],[wxn,wyx,0],
    [wxn,wyn,wzx],[wxx,wyn,wzx],[wxx,wyx,wzx],[wxn,wyx,wzx],
  ];
}

// ── Sub-block geometry ────────────────────────────────────────────────────────
// Sub-blocks in split mode are 1×1×1 cubes (half the height of the main block).
function splitBlockCorners(r, c) {
  return [
    [c,   r,   0], [c+1, r,   0], [c+1, r+1, 0], [c,   r+1, 0],
    [c,   r,   1], [c+1, r,   1], [c+1, r+1, 1], [c,   r+1, 1],
  ];
}

// ── Animation params ──────────────────────────────────────────────────────────
function animParams(r, c, orientation, action) {
  switch (orientation) {
    case ORIENT.STAND:
      if (action===ACT.N) return { type:'rotate', plane:'wy', pivot:r,   dir:'ccw' };
      if (action===ACT.S) return { type:'rotate', plane:'wy', pivot:r+1, dir:'cw'  };
      if (action===ACT.W) return { type:'rotate', plane:'wx', pivot:c,   dir:'ccw' };
      if (action===ACT.E) return { type:'rotate', plane:'wx', pivot:c+1, dir:'cw'  };
      break;
    case ORIENT.FLAT_V:
      if (action===ACT.N) return { type:'rotate', plane:'wy', pivot:r,   dir:'ccw' };
      if (action===ACT.S) return { type:'rotate', plane:'wy', pivot:r+2, dir:'cw'  };
      if (action===ACT.W) return { type:'rotate', plane:'wx', pivot:c,   dir:'ccw' };
      if (action===ACT.E) return { type:'rotate', plane:'wx', pivot:c+1, dir:'cw'  };
      break;
    case ORIENT.FLAT_H:
      if (action===ACT.N) return { type:'rotate', plane:'wy', pivot:r,   dir:'ccw' };
      if (action===ACT.S) return { type:'rotate', plane:'wy', pivot:r+1, dir:'cw'  };
      if (action===ACT.W) return { type:'rotate', plane:'wx', pivot:c,   dir:'ccw' };
      if (action===ACT.E) return { type:'rotate', plane:'wx', pivot:c+2, dir:'cw'  };
      break;
  }
  return null;
}

function transformCorners(corners, params, t) {
  const angle = t * Math.PI / 2;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return corners.map(([wx, wy, wz]) => {
    if (params.type === 'slide') {
      return [wx + (params.dwx||0)*t, wy + (params.dwy||0)*t, wz];
    }
    if (params.plane === 'wy') {
      const vy = wy - params.pivot, vz = wz;
      const ny = params.dir==='ccw' ? vy*cos - vz*sin : vy*cos + vz*sin;
      const nz = params.dir==='ccw' ? vy*sin + vz*cos : -vy*sin + vz*cos;
      return [wx, params.pivot + ny, nz];
    } else {
      const vx = wx - params.pivot, vz = wz;
      const nx = params.dir==='ccw' ? vx*cos - vz*sin : vx*cos + vz*sin;
      const nz = params.dir==='ccw' ? vx*sin + vz*cos : -vx*sin + vz*cos;
      return [params.pivot + nx, wy, nz];
    }
  });
}

// ── Draw polygon ──────────────────────────────────────────────────────────────
function poly(ctx, pts, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  if (fill)   { ctx.fillStyle   = fill;  ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = .8; ctx.stroke(); }
}

// ── Tile renderer ─────────────────────────────────────────────────────────────
// wzOff: vertical world-space offset (used for bridge slide-in animations)
function drawTile(ctx, r, c, tileKey, ox, oy, glowTime, wzOff) {
  const wz0 = wzOff || 0;
  const cols = PAL[tileKey] || PAL[TILE.SOLID];
  const p = (dwx, dwy, wz) => w2s(c + dwx, r + dwy, wz + wz0, ox, oy);

  const NW = p(0,0,0), NE = p(1,0,0), SE = p(1,1,0), SW = p(0,1,0);
  const edge = '#00000028';

  // South (front) slab face
  poly(ctx, [SW, SE, {x:SE.x,y:SE.y+SLAB}, {x:SW.x,y:SW.y+SLAB}], cols[1], edge);
  // East (right) slab face
  poly(ctx, [NE, SE, {x:SE.x,y:SE.y+SLAB}, {x:NE.x,y:NE.y+SLAB}], cols[2], edge);

  // Top face
  if (tileKey === TILE.GOAL) {
    _drawGoalTop(ctx, NW, NE, SE, SW, glowTime);
  } else {
    poly(ctx, [NW, NE, SE, SW], cols[0], edge);
    _drawTileOverlay(ctx, tileKey, NW, NE, SE, SW);
  }
}

function _drawGoalTop(ctx, NW, NE, SE, SW, glowTime) {
  // Dark void fill
  poly(ctx, [NW, NE, SE, SW], '#010108', null);

  // Subtle inner darkness gradient
  const cx = (NW.x + NE.x + SE.x + SW.x) / 4;
  const cy = (NW.y + NE.y + SE.y + SW.y) / 4;
  const rx = Math.abs(NE.x - NW.x) * 0.45;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
  grad.addColorStop(0, 'rgba(0,0,0,0.9)');
  grad.addColorStop(1, 'rgba(10,8,3,0)');
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(NW.x, NW.y); ctx.lineTo(NE.x, NE.y);
  ctx.lineTo(SE.x, SE.y); ctx.lineTo(SW.x, SW.y);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();

  // Pulsing gold border
  const glow = glowTime !== undefined ? 0.55 + 0.45 * Math.sin(glowTime * 0.004) : 1;
  ctx.save();
  ctx.shadowColor = '#4ade80';
  ctx.shadowBlur  = 24 * glow;
  ctx.strokeStyle = `rgba(74,222,128,${0.6 + 0.4 * glow})`;
  ctx.lineWidth   = 2.5;
  ctx.beginPath();
  ctx.moveTo(NW.x, NW.y); ctx.lineTo(NE.x, NE.y);
  ctx.lineTo(SE.x, SE.y); ctx.lineTo(SW.x, SW.y);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function _drawTileOverlay(ctx, tileKey, NW, NE, SE, SW) {
  // Bilinear interpolation over the tile parallelogram — makes overlays perspective-correct
  function uvPt(u, v) {
    return {
      x: NW.x + u * (NE.x - NW.x) + v * (SW.x - NW.x),
      y: NW.y + u * (NE.y - NW.y) + v * (SW.y - NW.y),
    };
  }

  if (tileKey === TILE.HARD_SW) {
    // Circle ring, UV-mapped onto the tile face (perspective-correct)
    const R_OUT = 0.34, R_IN = 0.19, N = 24;
    ctx.save();
    ctx.shadowColor = '#ffddcc'; ctx.shadowBlur = 6;
    ctx.fillStyle   = '#ffccaa';
    ctx.strokeStyle = '#5a2000'; ctx.lineWidth = 1;
    // Outer ring path (filled annulus via even-odd)
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const a = (2 * Math.PI * i) / N;
      const p = uvPt(0.5 + R_OUT * Math.cos(a), 0.5 + R_OUT * Math.sin(a));
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    // Inner cutout (winding rule creates the hole)
    for (let i = N - 1; i >= 0; i--) {
      const a = (2 * Math.PI * i) / N;
      const p = uvPt(0.5 + R_IN * Math.cos(a), 0.5 + R_IN * Math.sin(a));
      i === N - 1 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fill('evenodd');
    // Stroke both rings
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const a = (2 * Math.PI * i) / N;
      const p = uvPt(0.5 + R_OUT * Math.cos(a), 0.5 + R_OUT * Math.sin(a));
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
    }
    ctx.closePath(); ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const a = (2 * Math.PI * i) / N;
      const p = uvPt(0.5 + R_IN * Math.cos(a), 0.5 + R_IN * Math.sin(a));
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
    }
    ctx.closePath(); ctx.stroke();
    ctx.restore();

  } else if (tileKey === TILE.SOFT_SW) {
    // Bold X, UV-mapped onto the tile face
    const t = 0.17;
    const bar1 = [uvPt(0.15, 0.15+t), uvPt(0.15+t, 0.15), uvPt(0.85, 0.85-t), uvPt(0.85-t, 0.85)];
    const bar2 = [uvPt(0.85-t, 0.15), uvPt(0.85, 0.15+t), uvPt(0.15+t, 0.85), uvPt(0.15, 0.85-t)];
    ctx.save();
    ctx.shadowColor = '#ffddcc'; ctx.shadowBlur = 6;
    ctx.fillStyle   = '#ffccaa';
    ctx.strokeStyle = '#5a2000'; ctx.lineWidth = 1;
    for (const bar of [bar1, bar2]) {
      ctx.beginPath();
      ctx.moveTo(bar[0].x, bar[0].y);
      for (let i = 1; i < bar.length; i++) ctx.lineTo(bar[i].x, bar[i].y);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.restore();

  } else if (tileKey === TILE.TELE) {
    const cx = (NW.x + NE.x + SE.x + SW.x) / 4;
    const cy = (NW.y + NE.y + SE.y + SW.y) / 4 - 2;
    const s  = 7;
    ctx.save();
    ctx.shadowColor = '#818cf8'; ctx.shadowBlur = 7;
    ctx.strokeStyle = '#4f46e5'; ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 6;
      if (i === 0) ctx.moveTo(cx + s * Math.cos(a), cy + s * Math.sin(a));
      else         ctx.lineTo(cx + s * Math.cos(a), cy + s * Math.sin(a));
    }
    ctx.closePath(); ctx.stroke();
    ctx.restore();

  } else if (tileKey === TILE.SPLIT) {
    // Y-fork symbol representing block splitting into two halves
    const t = 0.13;  // bar half-thickness in UV space

    // Stem: center-bottom → center
    const stem = [
      uvPt(0.5 - t, 0.85), uvPt(0.5 + t, 0.85),
      uvPt(0.5 + t, 0.50), uvPt(0.5 - t, 0.50),
    ];
    // Left arm: center → upper-left
    const larm = [
      uvPt(0.5 - t, 0.52), uvPt(0.5 + t * 0.4, 0.44),
      uvPt(0.2 + t * 0.4, 0.18), uvPt(0.2 - t * 1.4, 0.24),
    ];
    // Right arm: center → upper-right
    const rarm = [
      uvPt(0.5 - t * 0.4, 0.44), uvPt(0.5 + t, 0.52),
      uvPt(0.8 + t * 1.4, 0.24), uvPt(0.8 - t * 0.4, 0.18),
    ];

    ctx.save();
    ctx.shadowColor = '#ffddcc'; ctx.shadowBlur = 6;
    ctx.fillStyle   = '#ffccaa';
    ctx.strokeStyle = '#5a2000'; ctx.lineWidth = 1;
    for (const seg of [stem, larm, rarm]) {
      ctx.beginPath();
      ctx.moveTo(seg[0].x, seg[0].y);
      for (let i = 1; i < seg.length; i++) ctx.lineTo(seg[i].x, seg[i].y);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }
}

// ── Block face renderer ───────────────────────────────────────────────────────
function drawBlockFaces(ctx, corners, flashColor, skipMortar) {
  const visible = [];
  for (const face of FACES) {
    const [i0,i1,,i3] = face.idx;
    const p0=corners[i0], p1=corners[i1], p3=corners[i3];
    const v1=[p1[0]-p0[0],p1[1]-p0[1],p1[2]-p0[2]];
    const v2=[p3[0]-p0[0],p3[1]-p0[1],p3[2]-p0[2]];
    const N = cross(v1, v2);
    if (dot(N, CAM) <= 0) continue;
    const depth = face.idx.reduce((s,i) => s + dot(corners[i], CAM), 0) / 4;
    visible.push({ face, N, depth });
  }
  visible.sort((a, b) => a.depth - b.depth);

  const L = norm([0.4, 1, 2]);
  for (const { face, N } of visible) {
    const pts = face.idx.map(i => {
      const [wx,wy,wz] = corners[i];
      return w2s(wx, wy, wz, _ox, _oy);
    });
    let color;
    if (flashColor) {
      color = flashColor;
    } else {
      const b = Math.max(0, dot(norm(N), L));
      color = b > .65 ? BLK.top : b > .25 ? BLK.south : BLK.east;
    }
    poly(ctx, pts, color, '#00000044');
  }

  // Specular sheen on top face
  if (!flashColor) {
    const tf = FACES.find(f => f.name === 'TOP');
    const [i0,i1,,i3] = tf.idx;
    const p0=corners[i0],p1=corners[i1],p3=corners[i3];
    const v1=[p1[0]-p0[0],p1[1]-p0[1],p1[2]-p0[2]];
    const v2=[p3[0]-p0[0],p3[1]-p0[1],p3[2]-p0[2]];
    if (dot(cross(v1, v2), CAM) > 0) {
      const topPts = tf.idx.map(i => { const [wx,wy,wz]=corners[i]; return w2s(wx,wy,wz,_ox,_oy); });
      const ccx = topPts.reduce((s,p)=>s+p.x,0)/4;
      const ccy = topPts.reduce((s,p)=>s+p.y,0)/4;
      const inner = topPts.map(p => ({ x: p.x*.3+ccx*.7, y: p.y*.3+ccy*.7 }));
      ctx.save(); ctx.globalAlpha = .18;
      poly(ctx, inner, '#ffffff', null);
      ctx.restore();
    }

    if (!skipMortar) {
      // Mortar joint lines on visible faces — gives the sandstone brick texture
      const wxn = corners[0][0], wxx = corners[2][0];
      const wyn = corners[0][1], wyx = corners[2][1];
      const wzB = corners[0][2], wzT = corners[4][2];
      const bH = wzT - wzB, bW = wxx - wxn, bD = wyx - wyn;

      ctx.save();
      ctx.strokeStyle = 'rgba(40,20,0,0.32)';
      ctx.lineWidth = 1.4;

      for (const { face } of visible) {
        if (face.name === 'SOUTH') {
          if (bH > 1.2) {
            const mz = wzB + bH * 0.5;
            const a = w2s(wxn, wyx, mz, _ox, _oy), b = w2s(wxx, wyx, mz, _ox, _oy);
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
          if (bW > 1.2) {
            const mx = wxn + bW * 0.5;
            const a = w2s(mx, wyx, wzB, _ox, _oy), b = w2s(mx, wyx, wzT, _ox, _oy);
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        } else if (face.name === 'EAST') {
          if (bH > 1.2) {
            const mz = wzB + bH * 0.5;
            const a = w2s(wxx, wyx, mz, _ox, _oy), b = w2s(wxx, wyn, mz, _ox, _oy);
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
          if (bD > 1.2) {
            const my = wyn + bD * 0.5;
            const a = w2s(wxx, my, wzB, _ox, _oy), b = w2s(wxx, my, wzT, _ox, _oy);
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        } else if (face.name === 'TOP') {
          if (bD > 1.2) {
            const my = wyn + bD * 0.5;
            const a = w2s(wxn, my, wzT, _ox, _oy), b = w2s(wxx, my, wzT, _ox, _oy);
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
          if (bW > 1.2) {
            const mx = wxn + bW * 0.5;
            const a = w2s(mx, wyn, wzT, _ox, _oy), b = w2s(mx, wyx, wzT, _ox, _oy);
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }
      ctx.restore();
    }
  }
}

// ── Block face renderer (custom projection) ───────────────────────────────────
// Used for the landing-page background blocks with a different camera/scale.
function drawBlockFacesCustom(ctx, corners, w2sFunc) {
  const visible = [];
  for (const face of FACES) {
    const [i0,i1,,i3] = face.idx;
    const p0=corners[i0], p1=corners[i1], p3=corners[i3];
    const v1=[p1[0]-p0[0],p1[1]-p0[1],p1[2]-p0[2]];
    const v2=[p3[0]-p0[0],p3[1]-p0[1],p3[2]-p0[2]];
    const N = cross(v1, v2);
    if (dot(N, CAM) <= 0) continue;
    const depth = face.idx.reduce((s,i) => s + dot(corners[i], CAM), 0) / 4;
    visible.push({ face, N, depth });
  }
  visible.sort((a, b) => a.depth - b.depth);
  const L = norm([0.4, 1, 2]);
  for (const { face, N } of visible) {
    const pts = face.idx.map(i => {
      const [wx,wy,wz] = corners[i];
      return w2sFunc(wx, wy, wz);
    });
    const b = Math.max(0, dot(norm(N), L));
    const color = b > .65 ? BLK.top : b > .25 ? BLK.south : BLK.east;
    poly(ctx, pts, color, '#00000044');
  }
}

// ── Split block colours ───────────────────────────────────────────────────────
// Active sub-block: warm amber glow; inactive: cool slate dimmed
const BLK_SPLIT_ACTIVE   = { top: '#f0c060', south: '#b07030', east: '#7a4820' };
const BLK_SPLIT_INACTIVE = { top: '#8898b8', south: '#4a5a78', east: '#2e3a52' };

// Draw a single 1×1 sub-block (always STAND orientation) at grid position (r,c).
// corners: pre-computed world-space corners (8 points) — may be animated.
// isActive: whether this sub-block is currently controlled by the player.
// switchT: 0→1 progress of the switch-flash animation (0 = no flash).
// switchToActive: if this sub-block is the one just becoming active.
function drawSplitBlockFaces(ctx, corners, isActive, glowTime, switchT, switchToActive) {
  const palette = isActive ? BLK_SPLIT_ACTIVE : BLK_SPLIT_INACTIVE;

  // Determine visible faces sorted front-to-back
  const visible = [];
  for (const face of FACES) {
    const [i0,i1,,i3] = face.idx;
    const p0=corners[i0], p1=corners[i1], p3=corners[i3];
    const v1=[p1[0]-p0[0],p1[1]-p0[1],p1[2]-p0[2]];
    const v2=[p3[0]-p0[0],p3[1]-p0[1],p3[2]-p0[2]];
    const N = cross(v1, v2);
    if (dot(N, CAM) <= 0) continue;
    const depth = face.idx.reduce((s,i) => s + dot(corners[i], CAM), 0) / 4;
    visible.push({ face, N, depth });
  }
  visible.sort((a, b) => a.depth - b.depth);

  const L = norm([0.4, 1, 2]);
  for (const { face, N } of visible) {
    const pts = face.idx.map(i => {
      const [wx,wy,wz] = corners[i];
      return w2s(wx, wy, wz, _ox, _oy);
    });
    const b = Math.max(0, dot(norm(N), L));
    let color = b > .65 ? palette.top : b > .25 ? palette.south : palette.east;
    poly(ctx, pts, color, '#00000044');
  }

  // Active-block pulsing glow ring on the top face
  if (isActive) {
    const tf = FACES.find(f => f.name === 'TOP');
    if (dot(cross(
      [corners[tf.idx[1]][0]-corners[tf.idx[0]][0], corners[tf.idx[1]][1]-corners[tf.idx[0]][1], corners[tf.idx[1]][2]-corners[tf.idx[0]][2]],
      [corners[tf.idx[3]][0]-corners[tf.idx[0]][0], corners[tf.idx[3]][1]-corners[tf.idx[0]][1], corners[tf.idx[3]][2]-corners[tf.idx[0]][2]]
    ), CAM) > 0) {
      const topPts = tf.idx.map(i => { const [wx,wy,wz]=corners[i]; return w2s(wx,wy,wz,_ox,_oy); });
      const pulse = 0.55 + 0.45 * Math.sin(glowTime * 0.007);
      ctx.save();
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur  = 18 * pulse;
      ctx.strokeStyle = `rgba(251,191,36,${(0.7 + 0.3 * pulse).toFixed(3)})`;
      ctx.lineWidth   = 2;
      ctx.beginPath();
      ctx.moveTo(topPts[0].x, topPts[0].y);
      for (let i = 1; i < topPts.length; i++) ctx.lineTo(topPts[i].x, topPts[i].y);
      ctx.closePath(); ctx.stroke();
      ctx.restore();
    }
  }

  // Switch-flash: cyan burst on the newly activated block
  if (switchT > 0 && switchToActive) {
    const alpha = Math.max(0, 1 - switchT);
    ctx.save();
    ctx.globalAlpha = alpha * 0.85;
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur  = 40;
    for (const { face } of visible) {
      if (face.name !== 'TOP') continue;
      const pts = face.idx.map(i => { const [wx,wy,wz]=corners[i]; return w2s(wx,wy,wz,_ox,_oy); });
      poly(ctx, pts, '#67e8f9', null);
    }
    ctx.restore();
  }
}

// ── Stars background ──────────────────────────────────────────────────────────
let _stars = null, _starsKey = '';

function _seededRng(seed) {
  let s = seed | 0;
  return () => {
    s = Math.imul(1664525, s) + 1013904223 | 0;
    return (s >>> 0) / 0x100000000;
  };
}

function _ensureStars(w, h) {
  const key = `${w}x${h}`;
  if (_starsKey === key) return;
  _starsKey = key;
  const rng = _seededRng(w * 1337 + h * 7919);
  const n = Math.floor(w * h / 1600);
  _stars = Array.from({ length: n }, () => ({
    x: rng() * w,
    y: rng() * h,
    r: 0.4 + rng() * 1.5,
    phase: rng() * Math.PI * 2,
    freq:  0.0006 + rng() * 0.0014,
  }));
}

function _drawStars(ctx, w, h, time) {
  _ensureStars(w, h);
  for (const s of _stars) {
    const a = 0.2 + 0.8 * (0.5 + 0.5 * Math.sin(time * s.freq + s.phase));
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(210,225,255,${a.toFixed(3)})`;
    ctx.fill();
  }
}

// ── Film grain ────────────────────────────────────────────────────────────────
let _grain = null, _grainKey = '';

function _ensureGrain(w, h) {
  const key = `${w}x${h}`;
  if (_grainKey === key) return;
  _grainKey = key;
  _grain = document.createElement('canvas');
  _grain.width = w; _grain.height = h;
  const gCtx = _grain.getContext('2d');
  const img = gCtx.createImageData(w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    img.data[i] = img.data[i+1] = img.data[i+2] = v;
    img.data[i+3] = 22;
  }
  gCtx.putImageData(img, 0, 0);
}

function _drawGrain(ctx, w, h) {
  _ensureGrain(w, h);
  ctx.save();
  ctx.globalAlpha = 0.065;
  ctx.drawImage(_grain, 0, 0);
  ctx.restore();
}

// ── Bridge index helper ───────────────────────────────────────────────────────
function getBridgeIdx(meta, r, c) {
  if (!meta || !meta.bridges) return null;
  for (let i = 0; i < meta.bridges.length; i++) {
    for (const [br, bc] of meta.bridges[i].tiles) {
      if (br === r && bc === c) return i;
    }
  }
  return null;
}

// ── Win-fall glow effect ──────────────────────────────────────────────────────
function _drawWinFallGlow(ctx, goalC, goalR, fp) {
  const center = w2s(goalC + 0.5, goalR + 0.5, 0, _ox, _oy);
  const t = Math.min(1, fp * 1.5);

  const glowR = 75 * t;
  if (glowR > 0) {
    const g = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, glowR);
    g.addColorStop(0,   `rgba(74,222,128,${(0.55 * t).toFixed(3)})`);
    g.addColorStop(0.4, `rgba(74,222,128,${(0.25 * t).toFixed(3)})`);
    g.addColorStop(1,   'rgba(74,222,128,0)');
    ctx.save();
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(center.x, center.y, glowR, glowR * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  for (let i = 0; i < 3; i++) {
    const phase = ((fp * 2.0) + i / 3) % 1;
    const ringR = 10 + phase * 80;
    const alpha = Math.max(0, (1 - phase) * 0.75 * Math.min(1, fp * 4));
    if (alpha <= 0.01) continue;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth   = 2.5 * (1 - phase * 0.7);
    ctx.shadowColor = '#4ade80';
    ctx.shadowBlur  = 14;
    ctx.beginPath();
    ctx.ellipse(center.x, center.y, ringR, ringR * 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// ── Split entry animation ─────────────────────────────────────────────────────
// Plays when the combined block lands on a split tile and bursts into two sub-blocks.
// sea.t: 0→1 progress (negative means roll phase handled by caller — not drawn here).
function _drawSplitEntry(ctx, sea, glowTime) {
  const { t, triggerR, triggerC, subA, subB } = sea;
  if (t < 0) return;

  // Screen-space center of the trigger tile (at the top surface, z=0)
  const ep = w2s(triggerC + 0.5, triggerR + 0.5, 0, _ox, _oy);

  // ── Phase 1 (t 0→0.35): shockwave ring + combined block fades out ──────────
  const burstFade = Math.max(0, 1 - t / 0.35);
  if (burstFade > 0) {
    // Expanding shockwave ring
    const ringR = 8 + (1 - burstFade) * 90;
    const ringR2 = ringR * 0.48;  // ellipse minor axis
    ctx.save();
    ctx.globalAlpha = burstFade * 0.9;
    ctx.shadowColor = '#a5f3fc'; ctx.shadowBlur = 28;
    ctx.strokeStyle = '#67e8f9'; ctx.lineWidth = 4 * burstFade + 1;
    ctx.beginPath();
    ctx.ellipse(ep.x, ep.y - ringR2 * 0.3, ringR, ringR2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    // Inner flash glow
    ctx.save();
    ctx.globalAlpha = burstFade * 0.55;
    const gg = ctx.createRadialGradient(ep.x, ep.y, 0, ep.x, ep.y, ringR * 0.7);
    gg.addColorStop(0, '#ffffff');
    gg.addColorStop(0.25, '#a5f3fc');
    gg.addColorStop(1,   'rgba(103,232,249,0)');
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.ellipse(ep.x, ep.y, ringR * 0.7, ringR * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Combined block fades out at trigger tile (t 0→0.28)
  if (t < 0.30) {
    const blockAlpha = Math.max(0, 1 - t / 0.22);
    const tCorn = blockCorners(triggerR, triggerC, ORIENT.STAND);
    ctx.save(); ctx.globalAlpha = blockAlpha;
    // Tint the fading block cyan-white as it disintegrates
    const tintColor = blockAlpha > 0.5 ? null : '#b0f0ff';
    drawBlockFaces(ctx, tCorn, tintColor, true);
    ctx.restore();
  }

  // ── Phase 2 (t 0.08→1.0): sub-blocks fly from trigger to destinations ──────
  const flyStart = 0.08;
  if (t > flyStart) {
    const flyT  = Math.min(1, (t - flyStart) / (1 - flyStart));
    const posT  = easeInOut(flyT);
    const arcZ  = Math.sin(Math.PI * flyT) * 3.2;   // parabolic altitude arc
    const alpha = Math.min(1, flyT * 2.2);

    [[subA, true], [subB, false]].forEach(([dest, isActive]) => {
      // Interpolated world position (fractional row/col)
      const wr = triggerR + (dest.r - triggerR) * posT;
      const wc = triggerC + (dest.c - triggerC) * posT;

      // 1×1×1 cube corners at the interpolated position + arc height
      const corn = [
        [wc,   wr,   arcZ],     [wc+1, wr,   arcZ],
        [wc+1, wr+1, arcZ],     [wc,   wr+1, arcZ],
        [wc,   wr,   1 + arcZ], [wc+1, wr,   1 + arcZ],
        [wc+1, wr+1, 1 + arcZ], [wc,   wr+1, 1 + arcZ],
      ];

      ctx.save();
      ctx.globalAlpha = alpha * (isActive ? 1.0 : 0.85);
      drawSplitBlockFaces(ctx, corn, isActive, glowTime, 0, false);
      ctx.restore();

      // Beam trail from trigger to sub-block current position
      const beamAlpha = Math.max(0, (1 - flyT) * 0.65);
      if (beamAlpha > 0.01) {
        const cp = w2s(wc + 0.5, wr + 0.5, 0.5 + arcZ, _ox, _oy);
        const color = isActive ? '#fbbf24' : '#67e8f9';
        ctx.save();
        ctx.globalAlpha = beamAlpha;
        ctx.strokeStyle = color; ctx.lineWidth = 3.5;
        ctx.shadowColor = color; ctx.shadowBlur  = 18;
        ctx.lineCap     = 'round';
        ctx.beginPath();
        ctx.moveTo(ep.x, ep.y); ctx.lineTo(cp.x, cp.y);
        ctx.stroke();
        // Glow dot at sub-block position
        ctx.beginPath();
        ctx.arc(cp.x, cp.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.fill();
        ctx.restore();
      }
    });
  }
}

// ── Main render function ──────────────────────────────────────────────────────
// Canvas must already be sized to the display area by fitCanvas() before calling.
// bridgeAnims: [{bridgeIdx, opening(bool), t(0→1)}] — bridge slide animations
// fallProgress: 0–1, block sinks into goal hole (win)
// edgeFall:     { progress:0–1, action:0-3 } | null — block drops off edge (fail)
// splitSwitchT: 0→1 switch-flash animation progress (0 = no flash)
// splitEntry:   { t, triggerR, triggerC, subA, subB } | null — split entry burst anim
function renderGame(canvas, state, anim, glowTime, flashColor, bridgeAnims, fallProgress, edgeFall, splitSwitchT, splitEntry) {
  if (!state || !canvas.width || !canvas.height) return;
  const ctx = canvas.getContext('2d');
  const { grid, block, split, bridges, fragile_broken, meta } = state;
  // During the roll phase (splitEntry.t < 0) suppress split rendering so the
  // normal roll animation plays to the trigger tile first.
  const isSplitMode = split !== null && split !== undefined
                      && !(splitEntry && splitEntry.t < 0);
  const H = grid.length, W = grid[0].length;

  // Arena dimensions: based on max level size so all levels share the same tile scale
  const refH = _refH || H, refW = _refW || W;
  const arenaW = 2 * PAD + refH * Math.abs(SX) + refW * EX;
  const arenaH = 2 * PAD + HZ * 2 + refW * EY + refH * SY + SLAB;

  // Scale arena to fill canvas (uniform across all levels)
  const s = Math.min(canvas.width / arenaW, canvas.height / arenaH);

  // Full-canvas background and stars (outside scaled context)
  ctx.fillStyle = '#040410';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  _drawStars(ctx, canvas.width, canvas.height, glowTime);

  // This level's natural size (may be smaller than arena)
  const levelW = 2 * PAD + H * Math.abs(SX) + W * EX;
  const levelH = 2 * PAD + HZ * 2 + W * EY + H * SY + SLAB;

  // Center arena in canvas, center level within arena
  const panX = (canvas.width  - arenaW * s) / 2;
  const panY = (canvas.height - arenaH * s) / 2;
  const lvlX = (arenaW - levelW) / 2;
  const lvlY = (arenaH - levelH) / 2;

  ctx.save();
  ctx.translate(panX, panY);
  ctx.scale(s, s);

  _ox = PAD + H * Math.abs(SX) + lvlX;
  _oy = PAD + HZ * 2           + lvlY;

  // Bridge animation wz offsets and alpha (fade in/out)
  const bridgeWz = {}, bridgeAlphaMap = {};
  if (bridgeAnims) {
    for (const ba of bridgeAnims) {
      bridgeWz[ba.bridgeIdx]        = ba.opening ? (-1 + ba.t) : -ba.t;
      bridgeAlphaMap[ba.bridgeIdx]  = ba.opening ? ba.t : 1 - ba.t;
    }
  }

  // Build tile list — bridge_off tiles are invisible (void)
  const tileList = [];
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const tv = grid[r][c];
      if (tv === TILE.VOID) continue;

      const isBroken = fragile_broken.some(([fr, fc]) => fr === r && fc === c);
      let key    = isBroken ? 'fragile_broken' : tv;
      let wzOff  = 0;
      let alpha  = 1;

      if (tv === TILE.BRIDGE && !isBroken) {
        const bi = getBridgeIdx(meta, r, c);
        const on = bi !== null && bridges[bi];

        if (bi !== null && bridgeWz[bi] !== undefined) {
          key   = 'bridge_on';
          wzOff = bridgeWz[bi];
          alpha = bridgeAlphaMap[bi];
        } else if (!on) {
          continue;  // inactive bridge — render as void
        } else {
          key = 'bridge_on';
        }
      }

      tileList.push({ r, c, key, depth: tileDepth(r, c), wzOff, alpha });
    }
  }
  tileList.sort((a, b) => a.depth - b.depth);

  // Win fall: block shrinks toward goal and sinks with cubic gravity
  const fp  = fallProgress || 0;
  // Fail fall: block flies off edge with directional momentum
  const efa = edgeFall;
  const efp = efa ? efa.progress : 0;
  const swT = splitSwitchT || 0;  // switch flash progress

  function _drawTileEntry(tile) {
    if (tile.alpha < 1) {
      ctx.save(); ctx.globalAlpha = tile.alpha;
      drawTile(ctx, tile.r, tile.c, tile.key, _ox, _oy, glowTime, tile.wzOff);
      ctx.restore();
    } else {
      drawTile(ctx, tile.r, tile.c, tile.key, _ox, _oy, glowTime, tile.wzOff);
    }
  }

  // Draw all tiles
  for (const tile of tileList) {
    _drawTileEntry(tile);
  }

  // ── SPLIT MODE: render two sub-blocks ─────────────────────────────────────
  if (isSplitMode) {
    // Split entry animation overrides normal split rendering while burst plays
    if (splitEntry && splitEntry.t >= 0) {
      _drawSplitEntry(ctx, splitEntry, glowTime);
      ctx.restore();
      _drawGrain(ctx, canvas.width, canvas.height);
      return;
    }

    const { sub_a, sub_b, active } = split;

    // Sub-blocks are 1×1×1 cubes (half height of main block)
    let aCorners = splitBlockCorners(sub_a.r, sub_a.c);
    let bCorners = splitBlockCorners(sub_b.r, sub_b.c);

    // Roll animation for the moving sub-block (uses same pivot math as main block)
    if (anim && anim.action !== null && anim.action !== ACT.SWITCH && anim.activeSub !== undefined) {
      const animT = easeInOut(Math.min(1, anim.progress));
      const from  = anim.fromBlock;
      const params = animParams(from.r, from.c, ORIENT.STAND, anim.action);
      const fromCorn = splitBlockCorners(from.r, from.c);
      const rolledCorn = params ? transformCorners(fromCorn, params, animT) : fromCorn;
      const whichMoving = anim.activeSub;
      if (whichMoving === 0) aCorners = rolledCorn;
      else                   bCorners = rolledCorn;
    }

    // Apply edge-fall to the active sub-block if fell
    if (efp > 0 && efa) {
      const DIR = [[-1,0],[0,1],[1,0],[0,-1]];
      const [DR, DC] = DIR[efa.action] || [0, 0];
      const fallWy = DR * efp * 3.0;
      const fallWx = DC * efp * 3.0;
      const fallZ  = efp * efp * 5.5;
      if (active === 0)
        aCorners = aCorners.map(([wx, wy, wz]) => [wx + fallWx, wy + fallWy, wz - fallZ]);
      else
        bCorners = bCorners.map(([wx, wy, wz]) => [wx + fallWx, wy + fallWy, wz - fallZ]);
    }

    const subAlpha = efp > 0 ? Math.max(0, 1 - efp * 1.1) : 1;

    // Draw inactive block first (painter's order: below active)
    const [inactiveCorners, activeCorners] =
      active === 0 ? [bCorners, aCorners] : [aCorners, bCorners];

    ctx.save();
    if (subAlpha < 1) ctx.globalAlpha = subAlpha * 0.85;
    else              ctx.globalAlpha = 0.85;
    drawSplitBlockFaces(ctx, inactiveCorners, false, glowTime, swT, false);
    ctx.restore();

    ctx.save();
    if (subAlpha < 1) ctx.globalAlpha = subAlpha;
    drawSplitBlockFaces(ctx, activeCorners, true, glowTime, swT, swT > 0);
    ctx.restore();

  } else {
    // ── NORMAL MODE: render single combined block ──────────────────────────

    // Recombination: show two sub-blocks rolling together, then snap to combined
    if (anim && anim.isMerge) {
      const animT    = easeInOut(Math.min(1, anim.progress));
      const params   = animParams(anim.fromBlock.r, anim.fromBlock.c, ORIENT.STAND, anim.action);
      const fromCorn = splitBlockCorners(anim.fromBlock.r, anim.fromBlock.c);
      const rolledCorn   = params ? transformCorners(fromCorn, params, animT) : fromCorn;
      const inactiveCorn = splitBlockCorners(anim.inactiveSub.r, anim.inactiveSub.c);
      ctx.save(); ctx.globalAlpha = 0.85;
      drawSplitBlockFaces(ctx, inactiveCorn, false, glowTime, 0, false);
      ctx.restore();
      drawSplitBlockFaces(ctx, rolledCorn, true, glowTime, 0, false);
      ctx.restore();
      _drawGrain(ctx, canvas.width, canvas.height);
      return;
    }

    let animCorn = null;
    if (anim && anim.action !== null && anim.action !== ACT.SWITCH && block) {
      const animT = easeInOut(Math.min(1, anim.progress));
      const from  = anim.fromBlock;
      const params = animParams(from.r, from.c, from.orientation, anim.action);
      if (params) {
        animCorn = transformCorners(blockCorners(from.r, from.c, from.orientation), params, animT);
      }
    }

    let drawCorners = animCorn || (block ? blockCorners(block.r, block.c, block.orientation) : null);
    if (!drawCorners) { ctx.restore(); _drawGrain(ctx, canvas.width, canvas.height); return; }

    if (fp > 0 && state.goal) {
      const gcx = state.goal.c + 0.5, gcy = state.goal.r + 0.5;
      const bcx = drawCorners.reduce((sum, [wx])   => sum + wx, 0) / drawCorners.length;
      const bcy = drawCorners.reduce((sum, [, wy]) => sum + wy, 0) / drawCorners.length;
      const shrink = Math.max(0.05, 1 - fp * 0.9);
      const fallZ  = fp * fp * fp * 6;
      drawCorners = drawCorners.map(([wx, wy, wz]) => {
        const nx = gcx + (bcx - gcx) * (1 - fp * 0.85) + (wx - bcx) * shrink;
        const ny = gcy + (bcy - gcy) * (1 - fp * 0.85) + (wy - bcy) * shrink;
        return [nx, ny, wz - fallZ];
      });
    }

    if (efp > 0 && efa) {
      const DIR = [[-1,0],[0,1],[1,0],[0,-1]];
      const [DR, DC] = DIR[efa.action] || [0, 0];
      const fallWy = DR * efp * 3.0;
      const fallWx = DC * efp * 3.0;
      const fallZ  = efp * efp * 5.5;
      drawCorners = drawCorners.map(([wx, wy, wz]) => [wx + fallWx, wy + fallWy, wz - fallZ]);
    }

    const blockAlpha =
      fp  > 0 ? Math.max(0, 1 - Math.max(0, (fp  - 0.55) / 0.3)) :
      efp > 0 ? Math.max(0, 1 - efp * 1.1) : 1;

    if (fp > 0 && state.goal) {
      _drawWinFallGlow(ctx, state.goal.c, state.goal.r, fp);
    }

    const skipMortar = animCorn !== null;
    if (blockAlpha < 1) {
      ctx.save(); ctx.globalAlpha = blockAlpha;
      drawBlockFaces(ctx, drawCorners, flashColor, skipMortar);
      ctx.restore();
    } else {
      drawBlockFaces(ctx, drawCorners, flashColor, skipMortar);
    }
  }

  ctx.restore();

  // Film grain over full canvas
  _drawGrain(ctx, canvas.width, canvas.height);
}

// ── Thumbnail renderer ────────────────────────────────────────────────────────
// Scaled-down version of the main projection for level gallery cards.
// Fixed 320×160 canvas; CSS width:100%/height:auto preserves the 2:1 ratio.
const MINI = { EX:14, EY:3, SX:-6, SY:8, HZ:8, SLAB:3, PAD:8 };

function renderThumbnail(canvas, levelData) {
  const { grid, meta } = levelData;
  const H = grid.length, W = grid[0].length;
  const { EX:mEX, EY:mEY, SX:mSX, SY:mSY, HZ:mHZ, SLAB:mSLAB, PAD:mp } = MINI;

  // Fixed output canvas — CSS aspect-ratio: 2/1 controls display height
  const TW = 320, TH = 160;
  canvas.width  = TW;
  canvas.height = TH;

  const ctx = canvas.getContext('2d');
  const mox = mp + H * Math.abs(mSX);
  const moy = mp + mHZ * 2;

  // Natural level projection size
  const levelW = 2 * mp + H * Math.abs(mSX) + W * mEX;
  const levelH = 2 * mp + mHZ * 2 + W * mEY + H * mSY + mSLAB;

  // Scale to fill thumb with 6px padding on each side
  const TPAD = 6;
  const s    = Math.min((TW - TPAD * 2) / levelW, (TH - TPAD * 2) / levelH);
  const offX = (TW - levelW * s) / 2;
  const offY = (TH - levelH * s) / 2;

  ctx.fillStyle = '#040410';
  ctx.fillRect(0, 0, TW, TH);

  ctx.save();
  ctx.translate(offX, offY);
  ctx.scale(s, s);

  function mw2s(wx, wy, wz) {
    return { x: mox + wx*mEX + wy*mSX, y: moy + wx*mEY + wy*mSY - wz*mHZ };
  }

  const tiles = [];
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (grid[r][c] === TILE.VOID) continue;
      tiles.push({ r, c, t: grid[r][c], depth: r + c * DEPTH_K });
    }
  }
  tiles.sort((a, b) => a.depth - b.depth);

  for (const { r, c, t } of tiles) {
    let key = t;
    if (t === TILE.BRIDGE) {
      const bi = getBridgeIdx(meta, r, c);
      // Only show bridges that are active at the start of the level
      if (bi === null || !meta.bridges[bi]?.initially_active) continue;
      key = 'bridge_on';
    }
    const cols = PAL[key] || PAL[TILE.SOLID];
    const NW=mw2s(c,r,0), NE=mw2s(c+1,r,0), SE=mw2s(c+1,r+1,0), SW=mw2s(c,r+1,0);

    // South face
    ctx.beginPath();
    ctx.moveTo(SW.x,SW.y); ctx.lineTo(SE.x,SE.y);
    ctx.lineTo(SE.x,SE.y+mSLAB); ctx.lineTo(SW.x,SW.y+mSLAB);
    ctx.closePath(); ctx.fillStyle=cols[1]; ctx.fill();
    // East face
    ctx.beginPath();
    ctx.moveTo(NE.x,NE.y); ctx.lineTo(SE.x,SE.y);
    ctx.lineTo(SE.x,SE.y+mSLAB); ctx.lineTo(NE.x,NE.y+mSLAB);
    ctx.closePath(); ctx.fillStyle=cols[2]; ctx.fill();
    // Top face
    if (t === TILE.GOAL) {
      ctx.beginPath();
      ctx.moveTo(NW.x,NW.y); ctx.lineTo(NE.x,NE.y);
      ctx.lineTo(SE.x,SE.y); ctx.lineTo(SW.x,SW.y);
      ctx.closePath(); ctx.fillStyle='#010108'; ctx.fill();
      ctx.strokeStyle='rgba(74,222,128,0.8)'; ctx.lineWidth=1/s; ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(NW.x,NW.y); ctx.lineTo(NE.x,NE.y);
      ctx.lineTo(SE.x,SE.y); ctx.lineTo(SW.x,SW.y);
      ctx.closePath(); ctx.fillStyle=cols[0]; ctx.fill();
      // Show switch/teleporter/split overlays on thumbnail
      if (t === TILE.SOFT_SW || t === TILE.HARD_SW || t === TILE.TELE || t === TILE.SPLIT) {
        _drawTileOverlay(ctx, t, NW, NE, SE, SW);
      }
    }
  }

  // Draw starting block in the actual amber/sandstone colour (not red)
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (grid[r][c] !== TILE.START) continue;
      const NW=mw2s(c,r,0), NE=mw2s(c+1,r,0), SE=mw2s(c+1,r+1,0), SW=mw2s(c,r+1,0);
      const ht = mHZ * 2;  // STAND = two tiles tall
      // South face
      ctx.beginPath();
      ctx.moveTo(SW.x,SW.y-ht); ctx.lineTo(SE.x,SE.y-ht);
      ctx.lineTo(SE.x,SE.y);    ctx.lineTo(SW.x,SW.y);
      ctx.closePath(); ctx.fillStyle = BLK.south; ctx.fill();
      // East face
      ctx.beginPath();
      ctx.moveTo(NE.x,NE.y-ht); ctx.lineTo(SE.x,SE.y-ht);
      ctx.lineTo(SE.x,SE.y);    ctx.lineTo(NE.x,NE.y);
      ctx.closePath(); ctx.fillStyle = BLK.east; ctx.fill();
      // Top face
      ctx.beginPath();
      ctx.moveTo(NW.x,NW.y-ht); ctx.lineTo(NE.x,NE.y-ht);
      ctx.lineTo(SE.x,SE.y-ht); ctx.lineTo(SW.x,SW.y-ht);
      ctx.closePath(); ctx.fillStyle = BLK.top; ctx.fill();
    }
  }

  ctx.restore();
}

// ── Canvas sizing ─────────────────────────────────────────────────────────────
// Sets canvas resolution to match the display area exactly — no CSS scaling,
// so rendering is always crisp at 1:1 pixels.
function fitCanvas(canvas, wrapEl) {
  const w = wrapEl.clientWidth  || (window.innerWidth  - 190);
  const h = wrapEl.clientHeight || window.innerHeight;
  if (w <= 0 || h <= 0) return;
  if (canvas.width === w && canvas.height === h) return;
  canvas.width        = w;
  canvas.height       = h;
  canvas.style.width  = w + 'px';
  canvas.style.height = h + 'px';
  canvas.style.transform = 'none';
}
