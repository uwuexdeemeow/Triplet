import { mix, type SceneId } from '@/appearance/looks';

/*
 * The 8-bit style's art as pixel maps: rows of characters, each standing for a colour. They're
 * drawn as SVG, one rectangle per run of same-coloured pixels in a row.
 */

type Colours = Record<string, string>;

// ACCENT is the trip colour, ACCENT_LIGHT a tint of it
const SPRITES: Record<string, { rows: string[]; colours: Colours }> = {
  backpacker: {
    rows: [
      '....HHHH....',
      '...HHHHHH...',
      '...HSSSSH...',
      '...SESSES...',
      '...SSSSSS...',
      '....SSSS....',
      '..BTTTTTTB..',
      '..BTTTTTTB..',
      '..SBTTTTBS..',
      '....PPPP....',
      '....P..P....',
      '...KK..KK...',
    ],
    colours: { H: '#3B2A1E', S: '#F2C29B', E: '#1A1A1A', T: 'ACCENT', B: '#7A4E2A', P: '#2E3440', K: '#1A1A1A' },
  },
  cat: {
    rows: [
      '..K......K..',
      '..KK....KK..',
      '..KKKKKKKK..',
      '..KYKKKKYK..',
      '..KKKPPKKK..',
      '...KKKKKK...',
      '..LLLLLLLL..',
      '..LSSSSSSL..',
      '..LSSSSSSL..',
      '..LLLLLLLL..',
      '...D....D...',
    ],
    colours: { K: '#2B2B33', Y: '#F2C94C', P: '#E89BB0', L: 'ACCENT', S: 'ACCENT_LIGHT', D: '#1A1A1A' },
  },
  robot: {
    rows: [
      '.....AA.....',
      '.....AA.....',
      '..GGGGGGGG..',
      '..GCCGGCCG..',
      '..GGGGGGGG..',
      '..GGMMMMGG..',
      '...GGGGGG...',
      '.GGRRRRRRGG.',
      '.G.RRYYRR.G.',
      '...RRRRRR...',
      '...GG..GG...',
      '..GGG..GGG..',
    ],
    colours: { A: 'ACCENT', G: '#AEB6C2', C: '#5FD3E6', M: '#5A6270', R: 'ACCENT', Y: '#F2C94C' },
  },
  ghost: {
    rows: [
      '....WWWW....',
      '..WWWWWWWW..',
      '.WWWWWWWWWW.',
      '.WWKWWWWKWW.',
      '.WWKWWWWKWW.',
      '.WWWWWWWWWW.',
      '.WWPWWWWPWW.',
      '.WWWWWWWWWW.',
      '.WWWWWWWWWW.',
      '.WW.WWWW.WW.',
      '.W...WW...W.',
    ],
    colours: { W: '#EEF0F6', K: '#2B2B33', P: '#F2A7B8' },
  },
  frog: {
    rows: [
      '..WW....WW..',
      '.WKKW..WKKW.',
      '.WKKWGGWKKW.',
      '.GWWGGGGWWG.',
      'GGGGGGGGGGGG',
      'GGDGGGGGGDGG',
      'GGGDDDDDDGGG',
      '.GGGGGGGGGG.',
      '..LLL..LLL..',
    ],
    colours: { W: '#FFFFFF', K: '#1A1A1A', G: '#5BA35B', D: '#2F6B33', L: '#3E7F3E' },
  },
  plane: {
    rows: [
      '......W.....',
      '.....WW.....',
      'T...WWW.....',
      'TT.WWWWWWWW.',
      'TTWWABABABWW',
      '.WWWWWWWWWWW',
      '.....WW.....',
      '......W.....',
    ],
    colours: { W: '#F4F5F7', T: 'ACCENT', A: 'ACCENT', B: '#2B2B33' },
  },
};

export function isPixelSprite(buddy: string): boolean {
  return buddy in SPRITES;
}

/** SVG rectangles for a pixel map, one unit per pixel. */
function rects(rows: string[], colours: Colours): string {
  const out: string[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const colour = colours[row[x]];
      let end = x + 1;
      while (end < row.length && row[end] === row[x]) end++;
      if (colour) out.push(`<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${colour}"/>`);
      x = end;
    }
  });
  return out.join('');
}

/** A whole SVG document for a sprite, with its size in pixels (columns × rows). */
export function spriteXml(buddy: string, accent: string): { xml: string; width: number; height: number } | null {
  const sprite = SPRITES[buddy];
  if (!sprite) return null;
  const colours: Colours = {};
  for (const [key, value] of Object.entries(sprite.colours)) {
    colours[key] = value === 'ACCENT' ? accent : value === 'ACCENT_LIGHT' ? mix(accent, '#FFFFFF', 0.4) : value;
  }
  const width = sprite.rows[0].length;
  const height = sprite.rows.length;
  return {
    xml: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">${rects(sprite.rows, colours)}</svg>`,
    width,
    height,
  };
}

// ---------- Scenes, sized to fill a banner of any shape ----------

type Grid = string[][];

function grid(width: number, height: number): Grid {
  return Array.from({ length: height }, () => Array<string>(width).fill('.'));
}

function put(g: Grid, x: number, y: number, colour: string) {
  if (y >= 0 && y < g.length && x >= 0 && x < g[0].length) g[y][x] = colour;
}

function cloud(g: Grid, x: number, y: number, length: number, colour = 'c') {
  for (let k = 0; k < length; k++) put(g, x + k, y, colour);
  for (let k = 1; k < length - 1; k++) put(g, x + k, y - 1, colour);
}

function city(W: number, H: number): Grid {
  const g = grid(W, H);
  for (let x = 2; x < W; x += 7) put(g, x, (x * 3) % 4, 's');
  const moon = W - 10;
  for (const [dx, dy] of [
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
    [0, 2],
    [1, 2],
    [1, 3],
    [2, 3],
  ])
    put(g, moon + dx, 1 + dy, 'm');
  const widths = [4, 5, 3, 6, 4, 5, 3, 6, 4, 3];
  const heights = [7, 10, 6, 11, 8, 12, 7, 9, 6, 10];
  // Buildings fill up to about two thirds of a tall banner
  const scale = Math.max(1, (H * 0.6) / 12);
  let x0 = 0;
  let i = 0;
  while (x0 < W) {
    const w = widths[i % widths.length];
    const h = Math.min(H - 2, Math.round(heights[i % heights.length] * scale));
    for (let y = H - 1 - h; y < H - 1; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const window = (x - x0) % 2 === 1 && x < x0 + w - 1 && (y - (H - 1 - h)) % 2 === 1;
        put(g, x, y, window ? ((x * 7 + y * 3 + i) % 5 < 3 ? 'w' : 'd') : i % 2 ? 'b' : 'B');
      }
    }
    x0 += w;
    i++;
  }
  for (let x = 0; x < W; x++) put(g, x, H - 1, 'g');
  return g;
}

function beach(W: number, H: number): Grid {
  const g = grid(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - 6;
      const dy = y - 3;
      if (dx * dx + dy * dy <= 5) g[y][x] = 'u';
    }
  }
  for (const [x, y, length] of [
    [16, 2, 5],
    [28, 1, 4],
    [W - 14, 3, 5],
  ])
    cloud(g, x, y, length);
  const seaTop = H - Math.max(6, Math.round(H * 0.3));
  for (let y = seaTop; y < seaTop + 2; y++) for (let x = 0; x < W; x++) g[y][x] = (x + y * 3) % 7 === 0 ? 'E' : 'e';
  for (let y = seaTop + 2; y < H; y++) for (let x = 0; x < W; x++) g[y][x] = (x * 5 + y * 3) % 11 === 0 ? 'A' : 'a';
  for (let palm = W - 10; palm > 0; palm -= 40) {
    for (let y = seaTop - 4; y < H - 1; y++) put(g, palm + (y < seaTop - 2 ? 1 : 0), y, 'p');
    for (const [dx, dy] of [
      [-3, 0],
      [-2, -1],
      [-1, -1],
      [0, -1],
      [1, -2],
      [2, -2],
      [3, -1],
      [4, -1],
      [5, 0],
      [-2, 1],
      [4, 1],
      [1, -1],
      [2, -1],
    ]) {
      put(g, palm + 1 + dx, seaTop - 4 + dy, 'l');
    }
  }
  return g;
}

function mountains(W: number, H: number): Grid {
  const g = grid(W, H);
  for (const [x, y, length] of [
    [12, 2, 5],
    [W - 16, 1, 4],
  ])
    cloud(g, x, y, length);
  const scale = Math.max(1, (H * 0.65) / 12);
  for (let cx = 8, k = 0; cx < W + 10; cx += Math.round(16 * scale), k++) {
    const h = Math.min(H - 2, Math.round([9, 12, 8, 11, 10][k % 5] * scale));
    const top = H - 1 - h;
    for (let y = top; y < H; y++) {
      const half = y - top;
      for (let x = cx - half; x <= cx + half; x++) put(g, x, y, y - top < 2 ? 'n' : x > cx ? 'R' : 'r');
    }
  }
  for (let y = H - 2; y < H; y++) for (let x = 0; x < W; x++) put(g, x, y, 'v');
  for (let tx = 3; tx < W; tx += 11) {
    for (const [dx, dy] of [
      [0, -4],
      [-1, -3],
      [0, -3],
      [1, -3],
      [-1, -2],
      [0, -2],
      [1, -2],
      [-2, -1],
      [-1, -1],
      [0, -1],
      [1, -1],
      [2, -1],
    ]) {
      put(g, tx + dx, H - 2 + dy, 't');
    }
  }
  return g;
}

const SCENE_ART: Record<SceneId, { draw: (W: number, H: number) => Grid; colours: (accent: string) => Colours }> = {
  city: {
    draw: city,
    colours: (a) => ({
      sky: mix(a, '#0B0D12', 0.55),
      s: '#FFFFFF',
      m: '#F4E9C8',
      b: mix(a, '#0B0D12', 0.78),
      B: mix(a, '#0B0D12', 0.7),
      w: '#F6D77A',
      d: mix(a, '#0B0D12', 0.6),
      g: mix(a, '#0B0D12', 0.85),
    }),
  },
  beach: {
    draw: beach,
    colours: (a) => ({
      sky: mix(a, '#FFFFFF', 0.72),
      u: '#F6C445',
      c: '#FFFFFF',
      e: mix(a, '#1E88C8', 0.55),
      E: '#BFE6F5',
      a: '#EBD7A2',
      A: '#D6BD7F',
      p: '#7A5230',
      l: '#3F8A4A',
    }),
  },
  mountains: {
    draw: mountains,
    colours: (a) => ({
      sky: mix(a, '#FFFFFF', 0.68),
      n: '#FFFFFF',
      r: '#8A96A3',
      R: '#6B7785',
      v: '#5E8C4A',
      t: '#2F5E3A',
      c: '#FFFFFF',
    }),
  },
};

export function sceneSky(scene: SceneId, accent: string): string {
  return SCENE_ART[scene].colours(accent).sky;
}

/** A scene `columns` × `rows` pixels big, as an SVG document drawn edge to edge. */
export function sceneXml(scene: SceneId, accent: string, columns: number, rows: number): string {
  const art = SCENE_ART[scene];
  const g = art.draw(columns, rows).map((row) => row.join(''));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${columns} ${rows}" preserveAspectRatio="none" shape-rendering="crispEdges">${rects(g, art.colours(accent))}</svg>`;
}
