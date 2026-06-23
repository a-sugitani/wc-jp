#!/usr/bin/env node
// BBC World Cup "Knockout Stage" schedule -> JST static page generator.
// Fetches the BBC schedule page, extracts the embedded __INITIAL_DATA__ JSON,
// and renders a self-contained index.html with all kickoff times in JST.

const fs = require("fs");
const path = require("path");

const SOURCE_URL = "https://www.bbc.com/sport/football/world-cup/schedule";
const OUT_FILE = path.join(__dirname, "public", "index.html");

// --- fetch -----------------------------------------------------------------
async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      // A normal browser UA; BBC serves the full __INITIAL_DATA__ blob to it.
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept-Language": "en-GB,en;q=0.9",
    },
  });
  if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status}`);
  return res.text();
}

// --- extract embedded JSON -------------------------------------------------
// The page contains:  __INITIAL_DATA__="<escaped JSON string>"
// i.e. a JS string literal whose contents are themselves JSON.
function extractInitialData(html) {
  const marker = '__INITIAL_DATA__="';
  const i = html.indexOf(marker);
  if (i === -1) throw new Error("__INITIAL_DATA__ not found in page");
  let j = i + marker.length - 1; // points at the opening quote
  // Scan a JS string literal honouring backslash escapes.
  let k = j + 1;
  for (; k < html.length; k++) {
    const c = html[k];
    if (c === "\\") {
      k++; // skip escaped char
      continue;
    }
    if (c === '"') break; // closing quote
  }
  const literal = html.slice(j, k + 1); // includes surrounding quotes
  const jsonText = JSON.parse(literal); // unescape -> JSON text
  return JSON.parse(jsonText); // -> object
}

function findWorldCupStore(data) {
  const stores = data.data || {};
  for (const key of Object.keys(stores)) {
    const store = stores[key];
    if (store && store.data && store.data.knockoutStage) return store.data;
  }
  throw new Error("knockoutStage not found in page data");
}

// --- formatting ------------------------------------------------------------
const jstDate = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
});
const jstTime = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
// "2026-06-30" style key in JST for grouping by day.
const jstDayKey = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function teamScore(t) {
  // Prefer penalty shootout, then extra time, then full time.
  if (t.penaltyShootoutScore != null && t.fulltimeScore != null)
    return `${t.fulltimeScore} (${t.penaltyShootoutScore})`;
  if (t.extratimeScore != null) return String(t.extratimeScore);
  if (t.fulltimeScore != null) return String(t.fulltimeScore);
  return null;
}

function renderMatch(m) {
  const ev = m.event || m;
  const home = ev.teams.find((t) => t.alignment === "home") || ev.teams[0];
  const away = ev.teams.find((t) => t.alignment === "away") || ev.teams[1];
  const d = new Date(ev.date.iso);

  const dateStr = jstDate.format(d);
  const timeStr = jstTime.format(d);

  const hs = teamScore(home);
  const as = teamScore(away);
  const played = hs != null && as != null;

  const homeWin = ev.winner === "home";
  const awayWin = ev.winner === "away";

  const status = ev.statusComment && ev.statusComment.value;
  const isLive = ev.status === "LiveEvent" || ev.status === "MidEvent";

  const scoreOrTime = played
    ? `<span class="score">${esc(hs)}<span class="dash">-</span>${esc(as)}</span>`
    : `<span class="kickoff">${esc(timeStr)}</span>`;

  const statusBadge = played
    ? `<span class="badge ft">${esc(status || "FT")}</span>`
    : isLive
    ? `<span class="badge live">${esc(status || "LIVE")}</span>`
    : "";

  return `
      <div class="match${isLive ? " is-live" : ""}">
        <div class="team home${homeWin ? " win" : ""}">
          <span class="name">${esc(home.name.fullName)}</span>
        </div>
        <div class="center">
          ${scoreOrTime}
          <div class="meta">
            <span class="date">${esc(dateStr)}</span>
            ${statusBadge}
          </div>
        </div>
        <div class="team away${awayWin ? " win" : ""}">
          <span class="name">${esc(away.name.fullName)}</span>
        </div>
      </div>`;
}

function renderRound(roundName, matches) {
  const body = matches.map(renderMatch).join("\n");
  return `
    <section class="round">
      <h2>${esc(roundName)}</h2>
      <div class="matches">${body}
      </div>
    </section>`;
}

function buildHtml(ks, builtAtIso) {
  const builtJst =
    jstDate.format(new Date(builtAtIso)) +
    " " +
    jstTime.format(new Date(builtAtIso));

  const sections = [];
  for (const r of ks.preFinalRounds || []) {
    sections.push(renderRound(r.roundName, r.matches));
  }
  if (ks.thirdPlacePlayoff && ks.thirdPlacePlayoff.match) {
    sections.push(
      renderRound(ks.thirdPlacePlayoff.roundName, [ks.thirdPlacePlayoff.match])
    );
  }
  if (ks.final && ks.final.match) {
    sections.push(renderRound(ks.final.roundName, [ks.final.match]));
  }

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>World Cup 決勝トーナメント（日本時間）</title>
<style>
  :root{
    --bg:#0b1220; --card:#141c2e; --line:#26304a; --txt:#e8edf7;
    --muted:#8a96b0; --accent:#4ea1ff; --win:#9ae6b4; --live:#ff5d6c;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--txt);
    font-family:system-ui,-apple-system,"Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif;
    line-height:1.5;-webkit-text-size-adjust:100%}
  header{padding:20px 16px 6px;max-width:760px;margin:0 auto}
  h1{font-size:1.25rem;margin:0 0 4px}
  .sub{color:var(--muted);font-size:.8rem}
  .tz{display:inline-block;background:var(--accent);color:#06101f;font-weight:700;
    border-radius:6px;padding:1px 8px;font-size:.8rem}
  main{max-width:760px;margin:0 auto;padding:8px 12px 48px}
  .round{margin-top:22px}
  .round h2{font-size:1rem;color:var(--accent);margin:0 0 8px;
    border-bottom:1px solid var(--line);padding-bottom:6px}
  .match{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;
    background:var(--card);border:1px solid var(--line);border-radius:10px;
    padding:10px 12px;margin-bottom:8px}
  .match.is-live{border-color:var(--live)}
  .team{min-width:0}
  .team .name{display:block;font-weight:600;font-size:.95rem;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .team.home{text-align:right}
  .team.away{text-align:left}
  .team.win .name{color:var(--win)}
  .center{text-align:center;min-width:96px}
  .kickoff{font-size:1.05rem;font-weight:700;font-variant-numeric:tabular-nums}
  .score{font-size:1.15rem;font-weight:800;font-variant-numeric:tabular-nums}
  .score .dash{color:var(--muted);margin:0 4px}
  .meta{margin-top:2px;font-size:.72rem;color:var(--muted);
    display:flex;gap:6px;justify-content:center;align-items:center;flex-wrap:wrap}
  .badge{border-radius:4px;padding:0 5px;font-weight:700;font-size:.68rem}
  .badge.ft{background:#26304a;color:#aebbd6}
  .badge.live{background:var(--live);color:#fff}
  footer{max-width:760px;margin:0 auto;padding:0 16px;color:var(--muted);font-size:.72rem}
  footer a{color:var(--accent)}
  @media (max-width:430px){
    .team .name{font-size:.85rem}
    .center{min-width:78px}
  }
</style>
</head>
<body>
<header>
  <h1>World Cup 決勝トーナメント</h1>
  <div class="sub">
    キックオフ時刻はすべて <span class="tz">日本時間 JST</span> 表示 ／
    データ元: <a style="color:inherit" href="${SOURCE_URL}">BBC Sport</a>
  </div>
</header>
<main>
${sections.join("\n")}
</main>
<footer>
  <p>最終更新: ${esc(builtJst)} (JST)。約30分ごとにBBCの最新データへ自動追従します。
  本ページはBBCの公開データを日本時間に変換して表示する非公式ページです。</p>
</footer>
</body>
</html>
`;
}

// --- main ------------------------------------------------------------------
async function main() {
  const builtAtIso = new Date().toISOString();
  const html = await fetchHtml(SOURCE_URL);
  const data = extractInitialData(html);
  const wc = findWorldCupStore(data);
  const out = buildHtml(wc.knockoutStage, builtAtIso);

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, out);
  const matchCount =
    (wc.knockoutStage.preFinalRounds || []).reduce(
      (n, r) => n + r.matches.length,
      0
    ) + 2;
  console.log(`Wrote ${OUT_FILE} (${matchCount} matches).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
