#!/usr/bin/env node
// BBC World Cup "Knockout Stage" -> JST static page generator.
// Fetches the BBC schedule page, extracts the embedded __INITIAL_DATA__ JSON,
// reconstructs the knockout bracket from the placeholder references
// (W-32-5, W-16-1, W-QF1, W-SF1 ...) and renders a self-contained index.html
// with all kickoff times in JST. Wide screens get a tournament bracket,
// narrow screens get a round-by-round list. Country flags shown as emoji.

const fs = require("fs");
const path = require("path");

const SOURCE_URL = "https://www.bbc.com/sport/football/world-cup/schedule";
const OUT_FILE = path.join(__dirname, "public", "index.html");

// --- fetch -----------------------------------------------------------------
async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept-Language": "en-GB,en;q=0.9",
    },
  });
  if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status}`);
  return res.text();
}

// The page contains:  __INITIAL_DATA__="<escaped JSON string>"
function extractInitialData(html) {
  const marker = '__INITIAL_DATA__="';
  const i = html.indexOf(marker);
  if (i === -1) throw new Error("__INITIAL_DATA__ not found in page");
  const j = i + marker.length - 1; // opening quote
  let k = j + 1;
  for (; k < html.length; k++) {
    const c = html[k];
    if (c === "\\") { k++; continue; }
    if (c === '"') break;
  }
  const literal = html.slice(j, k + 1);
  return JSON.parse(JSON.parse(literal));
}

function findWorldCupStore(data) {
  for (const key of Object.keys(data.data || {})) {
    const store = data.data[key];
    if (store && store.data && store.data.knockoutStage) return store.data;
  }
  throw new Error("knockoutStage not found in page data");
}

// --- flags (emoji) ---------------------------------------------------------
// Map BBC team-urn slug -> ISO 3166-1 alpha-2 (for a regional-indicator emoji).
const ISO2 = {
  argentina: "AR", australia: "AU", austria: "AT", belgium: "BE",
  brazil: "BR", canada: "CA", "cape-verde": "CV", colombia: "CO",
  "czech-republic": "CZ", "dr-congo": "CD", egypt: "EG", france: "FR",
  germany: "DE", ghana: "GH", iran: "IR", "ivory-coast": "CI", japan: "JP",
  jordan: "JO", mexico: "MX", morocco: "MA", netherlands: "NL", norway: "NO",
  paraguay: "PY", portugal: "PT", "south-korea": "KR", spain: "ES",
  sweden: "SE", switzerland: "CH", uruguay: "UY", usa: "US",
  // Other plausible 2026 qualifiers (kept so flags appear if standings shift):
  senegal: "SN", tunisia: "TN", algeria: "DZ", nigeria: "NG", cameroon: "CM",
  mali: "ML", "south-africa": "ZA", "saudi-arabia": "SA", qatar: "QA",
  uae: "AE", iraq: "IQ", uzbekistan: "UZ", china: "CN", india: "IN",
  indonesia: "ID", "new-zealand": "NZ", ecuador: "EC", peru: "PE",
  chile: "CL", venezuela: "VE", bolivia: "BO", panama: "PA",
  "costa-rica": "CR", honduras: "HN", jamaica: "JM", croatia: "HR",
  italy: "IT", poland: "PL", denmark: "DK", serbia: "RS", turkey: "TR",
  ukraine: "UA", greece: "GR", hungary: "HU", romania: "RO", slovenia: "SI",
  slovakia: "SK", ireland: "IE", "north-macedonia": "MK", albania: "AL",
  "bosnia-and-herzegovina": "BA", georgia: "GE", finland: "FI", israel: "IL",
  curacao: "CW", haiti: "HT", "el-salvador": "SV", guatemala: "GT",
  suriname: "SR", "trinidad-and-tobago": "TT", angola: "AO", gabon: "GA",
  benin: "BJ", "equatorial-guinea": "GQ", madagascar: "MG",
  mozambique: "MZ", namibia: "NA", zambia: "ZM", uganda: "UG",
  "burkina-faso": "BF", guinea: "GN", comoros: "KM", togo: "TG",
  kenya: "KE", tanzania: "TZ", sudan: "SD", libya: "LY", mauritania: "MR",
  bahrain: "BH", oman: "OM", kuwait: "KW", palestine: "PS", lebanon: "LB",
  syria: "SY", thailand: "TH", vietnam: "VN", malaysia: "MY",
  philippines: "PH", tajikistan: "TJ", kyrgyzstan: "KG", turkmenistan: "TM",
  "north-korea": "KP",
};
// UK home nations need subdivision (tag-sequence) flag emoji.
function subdivisionFlag(region) {
  return (
    "\u{1F3F4}" +
    [...region].map((c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join("") +
    "\u{E007F}"
  );
}
const SPECIAL_FLAG = {
  england: subdivisionFlag("gbeng"),
  scotland: subdivisionFlag("gbsct"),
  wales: subdivisionFlag("gbwls"),
};
function iso2ToEmoji(code) {
  return [...code]
    .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join("");
}
function flagFor(team) {
  if (!team.urn) return "";
  const slug = team.urn.split(":").pop();
  if (SPECIAL_FLAG[slug]) return SPECIAL_FLAG[slug];
  const iso = ISO2[slug];
  return iso ? iso2ToEmoji(iso) : "";
}

// --- date formatting (JST) -------------------------------------------------
const jstFull = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric", weekday: "short",
});
const jstMD = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", weekday: "short",
});
const jstTime = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false,
});
function jstShort(d) { return `${jstMD.format(d)} ${jstTime.format(d)}`; }

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// --- bracket reconstruction ------------------------------------------------
const ROUND_CODE = {
  "Last 32": "32", "Last 16": "16", "Quarter-finals": "QF", "Semi-finals": "SF",
};
function buildIndex(ks) {
  const idx = {};
  for (const r of ks.preFinalRounds || []) {
    const code = ROUND_CODE[r.roundName];
    if (!code) continue;
    for (const m of r.matches) idx[`${code}:${m.event.tracking.matchPosition}`] = m;
  }
  return idx;
}
function refKey(ph) {
  let m;
  if ((m = /^W-32-(\d+)$/.exec(ph))) return `32:${m[1]}`;
  if ((m = /^W-16-(\d+)$/.exec(ph))) return `16:${m[1]}`;
  if ((m = /^W-QF(\d+)$/.exec(ph))) return `QF:${m[1]}`;
  if ((m = /^W-SF(\d+)$/.exec(ph))) return `SF:${m[1]}`;
  return null;
}
function node(idx, key) {
  const m = idx[key];
  if (!m) return null;
  const code = key.split(":")[0];
  const [home, away] = m.event.teams;
  return { match: m, code, home: childOf(idx, home), away: childOf(idx, away) };
}
function childOf(idx, team) {
  const k = refKey(team.knockoutGroupPlaceholder || "");
  return k ? node(idx, k) : { leaf: true, team };
}
// Pre-order DFS (home subtree before away) → per-round columns in top-to-bottom order.
function collect(n, cols) {
  if (!n || n.leaf) return;
  (cols[n.code] || (cols[n.code] = [])).push(n.match);
  collect(n.home, cols);
  collect(n.away, cols);
}

// --- match card (shared by bracket + list) ---------------------------------
function teamScore(t) {
  if (t.penaltyShootoutScore != null && t.fulltimeScore != null)
    return `${t.fulltimeScore} (${t.penaltyShootoutScore})`;
  if (t.extratimeScore != null) return String(t.extratimeScore);
  if (t.fulltimeScore != null) return String(t.fulltimeScore);
  return null;
}
// Teams whose match isn't decided yet carry a placeholder (W-32-2, E1, ...).
// Render those as readable Japanese instead of the raw code.
function prettyTeam(t) {
  if (t.urn) return t.name.fullName; // resolved real team
  const ph = t.knockoutGroupPlaceholder || t.name.fullName || "";
  let m;
  if ((m = /^W-32-(\d+)$/.exec(ph))) return `32強 第${m[1]} 勝者`;
  if ((m = /^W-16-(\d+)$/.exec(ph))) return `16強 第${m[1]} 勝者`;
  if ((m = /^W-QF(\d+)$/.exec(ph))) return `準々 第${m[1]} 勝者`;
  if ((m = /^W-SF(\d+)$/.exec(ph))) return `準決 第${m[1]} 勝者`;
  if ((m = /^L-SF(\d+)$/.exec(ph))) return `準決 第${m[1]} 敗者`;
  if ((m = /^([A-Z])([12])$/.exec(ph))) return `${m[1]}組 ${m[2]}位`;
  if (/^[A-Z]{2,}3$/.test(ph)) return `3位 (${ph.slice(0, -1)}組)`;
  return ph;
}
function teamRow(t, win, played) {
  const sc = teamScore(t);
  const flag = flagFor(t);
  const undecided = !t.urn;
  return `<div class="trow${win ? " win" : ""}${undecided ? " tbd" : ""}">` +
    `<span class="flag">${flag}</span>` +
    `<span class="tname">${esc(prettyTeam(t))}</span>` +
    `<span class="tsc">${played && sc != null ? esc(sc) : ""}</span></div>`;
}
function renderCard(m) {
  const ev = m.event;
  const [home, away] = ev.teams;
  const d = new Date(ev.date.iso);
  const played = teamScore(home) != null && teamScore(away) != null;
  const status = ev.statusComment && ev.statusComment.value;
  const live = ev.status === "LiveEvent" || ev.status === "MidEvent";
  const badge = live
    ? ` <span class="badge live">${esc(status || "LIVE")}</span>`
    : played
    ? ` <span class="badge ft">${esc(status || "FT")}</span>`
    : "";
  return `<div class="card${live ? " is-live" : ""}">` +
    `<div class="dt">${esc(jstShort(d))}${badge}</div>` +
    teamRow(home, ev.winner === "home", played) +
    teamRow(away, ev.winner === "away", played) +
    `</div>`;
}

// --- bracket view ----------------------------------------------------------
function renderColumn(matches, cls, label, paired) {
  const head = `<div class="rhead">${esc(label)}</div>`;
  if (!paired) {
    const body = (matches || [])
      .map((m) => `<div class="match">${renderCard(m)}</div>`).join("");
    return `<div class="round ${cls}">${head}${body}</div>`;
  }
  let body = "";
  for (let i = 0; i < matches.length; i += 2) {
    body += `<div class="pair"><div class="match">${renderCard(matches[i])}</div>` +
      `<div class="match">${renderCard(matches[i + 1])}</div></div>`;
  }
  return `<div class="round ${cls}">${head}${body}</div>`;
}
function renderBracket(ks, idx) {
  const L = {}, R = {};
  collect(node(idx, "SF:1"), L);
  collect(node(idx, "SF:2"), R);
  const final = ks.final.match;
  const third = ks.thirdPlacePlayoff.match;
  return `<div class="bracket-view"><div class="bracket">
  <div class="side left">
    ${renderColumn(L["32"], "col32", "Last 32", true)}
    ${renderColumn(L["16"], "col16", "Last 16", true)}
    ${renderColumn(L["QF"], "colqf", "QF", true)}
    ${renderColumn(L["SF"], "colsf", "SF", false)}
  </div>
  <div class="center">
    <div class="final"><div class="rhead">Final</div><div class="match">${renderCard(final)}</div></div>
    <div class="third"><div class="rhead">3rd place</div><div class="match">${renderCard(third)}</div></div>
  </div>
  <div class="side right">
    ${renderColumn(R["SF"], "colsf", "SF", false)}
    ${renderColumn(R["QF"], "colqf", "QF", true)}
    ${renderColumn(R["16"], "col16", "Last 16", true)}
    ${renderColumn(R["32"], "col32", "Last 32", true)}
  </div>
</div></div>`;
}

// --- list view (narrow screens) -------------------------------------------
function renderList(ks) {
  const rounds = [];
  for (const r of ks.preFinalRounds || [])
    rounds.push([r.roundName, r.matches]);
  rounds.push([ks.thirdPlacePlayoff.roundName, [ks.thirdPlacePlayoff.match]]);
  rounds.push([ks.final.roundName, [ks.final.match]]);
  return `<div class="list-view">` + rounds.map(([name, matches]) =>
    `<section class="lround"><h2>${esc(name)}</h2>` +
    `<div class="cards">${matches.map(renderCard).join("")}</div></section>`
  ).join("") + `</div>`;
}

// --- page ------------------------------------------------------------------
function buildHtml(ks, builtAtIso) {
  const idx = buildIndex(ks);
  const builtJst = `${jstFull.format(new Date(builtAtIso))} ${jstTime.format(new Date(builtAtIso))}`;
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>World Cup 決勝トーナメント（日本時間）</title>
<style>
  :root{--bg:#0b1220;--card:#141c2e;--line:#33405f;--txt:#e8edf7;--muted:#8a96b0;
    --accent:#4ea1ff;--win:#9ae6b4;--live:#ff5d6c}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--txt);
    font-family:system-ui,-apple-system,"Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif;
    line-height:1.45;-webkit-text-size-adjust:100%}
  header{padding:18px 16px 4px;max-width:1100px;margin:0 auto}
  h1{font-size:1.2rem;margin:0 0 4px}
  .sub{color:var(--muted);font-size:.8rem}
  .tz{display:inline-block;background:var(--accent);color:#06101f;font-weight:700;
    border-radius:6px;padding:1px 8px;font-size:.8rem}
  footer{max-width:1100px;margin:0 auto;padding:8px 16px 40px;color:var(--muted);font-size:.72rem}
  footer a{color:var(--accent)}

  /* ---- match card (shared) ---- */
  .card{background:var(--card);border:1px solid var(--line);border-radius:9px;padding:6px 8px}
  .card.is-live{border-color:var(--live)}
  .dt{font-size:.68rem;color:var(--muted);margin-bottom:3px;font-variant-numeric:tabular-nums;
    display:flex;gap:6px;align-items:center}
  .trow{display:flex;align-items:center;gap:6px;font-size:.86rem;font-weight:600;padding:1px 0}
  .trow.win{color:var(--win)}
  .trow.tbd{color:var(--muted);font-weight:500;font-style:italic}
  .flag{flex:0 0 auto;font-size:1.05rem;width:1.4em;text-align:center}
  .tname{flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tsc{flex:0 0 auto;font-variant-numeric:tabular-nums;font-weight:800}
  .badge{border-radius:4px;padding:0 5px;font-weight:700;font-size:.66rem}
  .badge.ft{background:#26304a;color:#aebbd6}
  .badge.live{background:var(--live);color:#fff}

  /* ---- list view (default / narrow) ---- */
  .list-view{max-width:1100px;margin:0 auto;padding:6px 12px}
  .lround{margin-top:18px}
  .lround h2{font-size:1rem;color:var(--accent);margin:0 0 8px;
    border-bottom:1px solid var(--line);padding-bottom:6px}
  .cards{display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(250px,1fr))}
  .bracket-view{display:none}

  /* ---- bracket view (wide) ---- */
  @media(min-width:980px){
    .list-view{display:none}
    .bracket-view{display:block;overflow-x:auto;padding:10px 16px 24px}
    .bracket{display:flex;align-items:stretch;min-width:1180px;margin:0 auto;width:max-content}
    .side{display:flex;align-items:stretch}
    .round{position:relative;display:flex;flex-direction:column;justify-content:space-around;
      padding:30px 16px 4px;min-width:180px}
    .pair{position:relative;display:flex;flex-direction:column;justify-content:space-around;flex:1 1 auto}
    .match{position:relative;display:flex;flex-direction:column;justify-content:center}
    .rhead{position:absolute;top:4px;left:0;right:0;text-align:center;
      font-size:.72rem;font-weight:700;color:var(--accent);letter-spacing:.04em}
    .center{position:relative;display:flex;flex-direction:column;justify-content:center;
      padding:30px 6px 4px;min-width:200px}
    .center .match{margin:0}
    .center .rhead{position:static;margin-bottom:6px}
    .center .third{position:absolute;left:6px;right:6px;bottom:6px}
    .third .card{opacity:.92}

    /* connectors: left side feeds right */
    .left .pair::after{content:"";position:absolute;left:100%;top:25%;bottom:25%;width:16px;
      border:2px solid var(--line);border-left:0;border-radius:0 10px 10px 0}
    .left .col16 .match::before,.left .colqf .match::before,.left .colsf .match::before{
      content:"";position:absolute;right:100%;top:50%;width:16px;border-top:2px solid var(--line)}
    .left .colsf .match::after{content:"";position:absolute;left:100%;top:50%;width:16px;
      border-top:2px solid var(--line)}
    /* connectors: right side feeds left */
    .right .pair::after{content:"";position:absolute;right:100%;top:25%;bottom:25%;width:16px;
      border:2px solid var(--line);border-right:0;border-radius:10px 0 0 10px}
    .right .col16 .match::after,.right .colqf .match::after,.right .colsf .match::after{
      content:"";position:absolute;left:100%;top:50%;width:16px;border-top:2px solid var(--line)}
    .right .colsf .match::before{content:"";position:absolute;right:100%;top:50%;width:16px;
      border-top:2px solid var(--line)}
  }
</style>
</head>
<body>
<header>
  <h1>World Cup 決勝トーナメント</h1>
  <div class="sub">
    キックオフ時刻はすべて <span class="tz">日本時間 JST</span> 表示 ／
    データ元: <a style="color:inherit" href="${SOURCE_URL}">BBC Sport</a><br>
    広い画面ではトーナメント表、スマホ等ではラウンド別リストで表示します。
  </div>
</header>
${renderBracket(ks, idx)}
${renderList(ks)}
<footer>
  <p>最終更新: ${esc(builtJst)} (JST)。約30分ごとにBBCの最新データへ自動追従します。
  対戦カードが未確定の枠はBBCの暫定表示（現在の順位順）に従います。
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
  console.log(`Wrote ${OUT_FILE}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
