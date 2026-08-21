#!/usr/bin/env node
// scripts/generate-terminal.js
// Genera un SVG tipo terminal "hacker" con stats reales de GitHub.
// Cicla en loop infinito entre varias "pantallas" (SMIL puro, sin JS,
// para que GitHub lo pueda renderizar como <img>).

import fs from "node:fs";

const USERNAME = process.env.GH_USERNAME;
const TOKEN = process.env.GH_TOKEN;

if (!USERNAME || !TOKEN) {
  console.error("Faltan GH_USERNAME o GH_TOKEN en el entorno");
  process.exit(1);
}

const query = `
  query($login: String!) {
    user(login: $login) {
      repositories(first: 100, ownerAffiliations: OWNER, isFork: false) {
        totalCount
        nodes { stargazerCount primaryLanguage { name } }
      }
      contributionsCollection {
        contributionCalendar { totalContributions }
      }
    }
  }
`;

async function fetchStats() {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables: { login: USERNAME } }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data.user;
}

function topLanguage(repos) {
  const counts = {};
  for (const r of repos) {
    const lang = r.primaryLanguage?.name;
    if (lang) counts[lang] = (counts[lang] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "N/A";
}

function escapeXml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// --- Config de tiempos (segundos) ---
const CHAR_DELAY = 0.045; // velocidad de tipeo por caracter
const LINE_GAP = 0.15; // pausa entre lineas dentro de una pantalla
const SCREEN_HOLD = 1.8; // cuanto se queda la pantalla ya escrita, antes de limpiarse
const SCREEN_GAP = 0.4; // pausa en negro antes de que empiece la siguiente pantalla
const INITIAL_DELAY = 0.3;
const CUT_EPS = 0.05; // duracion del "corte" instantaneo al limpiar pantalla
const CHAR_WIDTH = 8.4;
const FONT_SIZE = 14;
const LINE_HEIGHT = 22;
const PADDING = 20;
const START_Y = 50;

// convierte una lista de puntos [segundosAbsolutos, valor] a keyTimes/values
// normalizados sobre la duracion total T, garantizando orden estrictamente creciente.
function timeline(points, T) {
  const minGap = 0.0006;
  let lastFrac = -1;
  const out = [];
  for (const [t, v] of points) {
    let f = Math.max(0, Math.min(1, t / T));
    if (f <= lastFrac) f = Math.min(1, lastFrac + minGap);
    out.push([f, v]);
    lastFrac = f;
  }
  return {
    keyTimes: out.map((p) => p[0].toFixed(4)).join(";"),
    values: out.map((p) => p[1]).join(";"),
  };
}

function buildLoopedTerminal(screens, username) {
  // 1) calcular timing absoluto de cada pantalla y cada linea
  let cursor = INITIAL_DELAY;
  const laidOut = screens.map((screen) => {
    const screenStart = cursor;
    let lineCursor = 0;
    const lines = screen.lines.map((line) => {
      const dur = Math.max(line.text.length * CHAR_DELAY, 0.15);
      const startAbs = screenStart + lineCursor;
      const endAbs = startAbs + dur;
      lineCursor += dur + LINE_GAP;
      return { ...line, startAbs, endAbs };
    });
    const typingEnd = screenStart + lineCursor - LINE_GAP;
    const screenEnd = typingEnd + SCREEN_HOLD;
    cursor = screenEnd + SCREEN_GAP;
    return { lines, screenStart, screenEnd, typingEnd };
  });
  const T = cursor;

  const maxLines = Math.max(...screens.map((s) => s.lines.length));
  const width = 560;
  const height = START_Y + maxLines * LINE_HEIGHT + PADDING;

  const groups = laidOut.map((screen, gi) => {
    const opac = timeline(
      [
        [0, 0],
        [Math.max(0, screen.screenStart - CUT_EPS), 0],
        [screen.screenStart, 1],
        [screen.screenEnd, 1],
        [screen.screenEnd + CUT_EPS, 0],
        [T, 0],
      ],
      T
    );

    const textEls = screen.lines.map((line, li) => {
      const y = START_Y + li * LINE_HEIGHT;
      const w = Math.max(line.text.length * CHAR_WIDTH, 1);
      const wl = timeline(
        [
          [0, 0],
          [line.startAbs, 0],
          [line.endAbs, w],
          [screen.screenEnd, w],
          [screen.screenEnd + CUT_EPS, 0],
          [T, 0],
        ],
        T
      );
      const clipId = `clip-${gi}-${li}`;
      return `
      <clipPath id="${clipId}">
        <rect x="${PADDING}" y="${y - FONT_SIZE}" width="0" height="${FONT_SIZE + 6}">
          <animate attributeName="width" keyTimes="${wl.keyTimes}" values="${wl.values}" dur="${T.toFixed(3)}s" begin="0s" repeatCount="indefinite" />
        </rect>
      </clipPath>
      <text x="${PADDING}" y="${y}" font-family="'Fira Code', Consolas, monospace" font-size="${FONT_SIZE}" fill="${line.color}" filter="url(#glow)" clip-path="url(#${clipId})">${escapeXml(line.text)}</text>`;
    });

    const last = screen.lines[screen.lines.length - 1];
    const lastY = START_Y + (screen.lines.length - 1) * LINE_HEIGHT;
    const cursorX = PADDING + last.text.length * CHAR_WIDTH + 3;

    return `
    <g opacity="0">
      <animate attributeName="opacity" keyTimes="${opac.keyTimes}" values="${opac.values}" dur="${T.toFixed(3)}s" begin="0s" repeatCount="indefinite" />
      ${textEls.join("\n")}
      <rect x="${cursorX}" y="${lastY - FONT_SIZE}" width="8" height="${FONT_SIZE + 4}" fill="#39d353">
        <animate attributeName="opacity" values="1;0;1" dur="1s" begin="${screen.typingEnd.toFixed(3)}s" repeatCount="indefinite" />
      </rect>
    </g>`;
  });

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="0.6" result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  </defs>
  <rect width="100%" height="100%" rx="10" fill="#0d1117" />
  <rect width="100%" height="100%" rx="10" fill="none" stroke="#30363d" stroke-width="1" />
  <circle cx="22" cy="20" r="6" fill="#ff5f56" />
  <circle cx="42" cy="20" r="6" fill="#ffbd2e" />
  <circle cx="62" cy="20" r="6" fill="#27c93f" />
  <text x="${width / 2}" y="24" font-family="'Fira Code', Consolas, monospace" font-size="12" fill="#8b949e" text-anchor="middle">${escapeXml(username)}@github: ~</text>
  ${groups.join("\n")}
</svg>`;
}

const BLUE = "#58a6ff"; // prompts
const GREEN = "#39d353"; // output normal
const AMBER = "#e3b341"; // CTA

async function main() {
  const user = await fetchStats();
  const repos = user.repositories.nodes;
  const totalStars = repos.reduce((sum, r) => sum + r.stargazerCount, 0);
  const contributions = user.contributionsCollection.contributionCalendar.totalContributions;
  const year = new Date().getFullYear();

  const screens = [
    {
      lines: [
        { text: "mdao@github:~$ whoami", color: BLUE },
        { text: USERNAME, color: GREEN },
        { text: "mdao@github:~$ cat stats.txt", color: BLUE },
        { text: `Repos    : ${user.repositories.totalCount}`, color: GREEN },
        { text: `Stars    : ${totalStars}`, color: GREEN },
        { text: `Top Lang : ${topLanguage(repos)}`, color: GREEN },
        { text: `Commits ${year} : ${contributions}`, color: GREEN },
      ],
    },
    {
      lines: [
        { text: "mdao@github:~$ cat currently.txt", color: BLUE },
        { text: "> Building web & mobile products", color: GREEN },
        { text: "> React / React Native / Node.js", color: GREEN },
        { text: "> Shipping AI-powered features", color: GREEN },
      ],
    },
    {
      lines: [
        { text: "mdao@github:~$ echo $STATUS", color: BLUE },
        { text: "Want to make your project a reality?", color: AMBER },
        { text: "Contact me :)", color: AMBER },
      ],
    },
  ];

  const svg = buildLoopedTerminal(screens, USERNAME);
  fs.mkdirSync("assets", { recursive: true });
  fs.writeFileSync("assets/terminal.svg", svg);
  console.log("SVG generado en assets/terminal.svg");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
