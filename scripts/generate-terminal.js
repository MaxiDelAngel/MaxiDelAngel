#!/usr/bin/env node
// scripts/generate-terminal.js
// Genera un SVG tipo terminal "hacker" con stats reales de GitHub, con efecto
// de tipeo animado (SMIL, sin JS — así lo puede renderizar GitHub).

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
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] ?? "N/A";
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildSvg(lines) {
  const charWidth = 8.4;
  const fontSize = 14;
  const lineHeight = 22;
  const padding = 20;
  const startY = 50;
  const perCharDelay = 0.045;
  const linePause = 0.25;

  const width = 560;
  const height = startY + lines.length * lineHeight + padding;

  let t = 0.3; // pequeño delay inicial
  const lineSvgs = lines.map((line, i) => {
    const y = startY + i * lineHeight;
    const textWidth = Math.max(line.length * charWidth, 1);
    const dur = Math.max(line.length * perCharDelay, 0.2);
    const begin = t;
    t += dur + linePause;

    const isPrompt = line.startsWith("guest@");
    const color = isPrompt ? "#58a6ff" : "#39d353";
    const clipId = `clip-${i}`;

    return `
    <clipPath id="${clipId}">
      <rect x="${padding}" y="${y - fontSize}" width="0" height="${fontSize + 6}">
        <animate attributeName="width" from="0" to="${textWidth}" begin="${begin}s" dur="${dur}s" fill="freeze" />
      </rect>
    </clipPath>
    <text x="${padding}" y="${y}" font-family="'Fira Code', Consolas, monospace" font-size="${fontSize}" fill="${color}" clip-path="url(#${clipId})">${escapeXml(line)}</text>`;
  });

  const lastLine = lines[lines.length - 1];
  const lastY = startY + (lines.length - 1) * lineHeight;
  const cursorX = padding + lastLine.length * charWidth + 3;

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" rx="10" fill="#0d1117" />
  <circle cx="22" cy="20" r="6" fill="#ff5f56" />
  <circle cx="42" cy="20" r="6" fill="#ffbd2e" />
  <circle cx="62" cy="20" r="6" fill="#27c93f" />
  ${lineSvgs.join("\n")}
  <rect x="${cursorX}" y="${lastY - fontSize}" width="8" height="${fontSize + 4}" fill="#39d353">
    <animate attributeName="opacity" values="1;0;1" dur="1s" begin="${t}s" repeatCount="indefinite" />
  </rect>
</svg>`;
}

async function main() {
  const user = await fetchStats();
  const repos = user.repositories.nodes;
  const totalStars = repos.reduce((sum, r) => sum + r.stargazerCount, 0);
  const contributions = user.contributionsCollection.contributionCalendar.totalContributions;
  const year = new Date().getFullYear();

  const lines = [
    "guest@github:~$ whoami",
    USERNAME,
    "guest@github:~$ neofetch --stats",
    `Repos         : ${user.repositories.totalCount}`,
    `Stars         : ${totalStars}`,
    `Top Lang      : ${topLanguage(repos)}`,
    `Commits ${year} : ${contributions}`,
    "guest@github:~$ _",
  ];

  const svg = buildSvg(lines);
  fs.mkdirSync("assets", { recursive: true });
  fs.writeFileSync("assets/terminal.svg", svg);
  console.log("SVG generado en assets/terminal.svg");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});