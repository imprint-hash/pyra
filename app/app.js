/**
 * The broker, as one pure function.
 *
 * `handle()` takes a request and an account and returns HTML plus the account
 * that should be stored back. It touches no globals and no I/O, so the same
 * code serves a local Node process and a serverless function — which matters
 * because the flows under test must exercise the deployed app and the local
 * one identically, or a green run locally proves nothing about the live URL.
 *
 * Rules live in logic.js and are imported, never reimplemented here. That file
 * is the only thing the fault injector rewrites.
 */

import { MARKET, findStock, money, orderTotal, validateOrder } from "./logic.js";

export const OPENING_CASH = 5_000_00;

export const newAccount = () => ({ cash: OPENING_CASH, holdings: {} });


/**
 * Presentation-only data.
 *
 * Kept here rather than in logic.js because that file is the one the fault
 * injector rewrites, and a mutation must stay a single edit to a rule — not
 * something that also happens to move a chart.
 *
 * The series are fixed, never generated. A price line that changed between
 * renders would make a flow's assertion fail for reasons that have nothing to
 * do with whether the app is broken.
 */
const TAPE = {
  NVDA: { change: +2.41, series: [58, 61, 57, 64, 69, 66, 72, 78, 74, 81, 86, 84] },
  AAPL: { change: -0.87, series: [72, 70, 73, 68, 66, 69, 64, 61, 63, 58, 60, 57] },
  TSLA: { change: +1.12, series: [44, 47, 45, 51, 49, 54, 58, 55, 60, 63, 61, 66] },
};

/** A sparkline as an inline path — no assets, no requests. */
function spark(series, up) {
  const w = 104, h = 30, min = Math.min(...series), max = Math.max(...series);
  const span = max - min || 1;
  const pts = series.map((v, i) => {
    const x = (i / (series.length - 1)) * w;
    const y = h - ((v - min) / span) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true" class="spark">
    <polyline points="${pts.join(" ")}" fill="none" stroke="${up ? "var(--up)" : "var(--down)"}" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

const pct = (n) => `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;

const esc = (s) => String(s).replace(/[<>&"]/g, (c) =>
  ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

function page(title, body, active = "") {
  const nav = (href, label, id) =>
    `<a href="${href}"${id ? ` id="${id}"` : ""} class="${active === label ? "on" : ""}">${label}</a>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Bellweather</title>
<style>
 :root{
   --bg:#0B0E14; --panel:#121722; --panel2:#161C29; --line:#222A3A;
   --ink:#E6EAF2; --dim:#8A94A8; --up:#22C55E; --down:#F0525B; --accent:#4C8DFF;
   --mono:ui-monospace,"SF Mono","Cascadia Mono",Consolas,monospace;
 }
 @media(prefers-color-scheme:light){
   :root{--bg:#F4F6FA;--panel:#FFFFFF;--panel2:#F8FAFD;--line:#E2E7F0;
         --ink:#101725;--dim:#5D6779;--up:#0E9F5B;--down:#D03A44;--accent:#2563EB}
 }
 *{box-sizing:border-box}
 body{margin:0;background:var(--bg);color:var(--ink);
   font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
   -webkit-font-smoothing:antialiased}
 .num{font-family:var(--mono);font-variant-numeric:tabular-nums}
 a{color:var(--accent);text-decoration:none}

 .topbar{display:flex;align-items:center;gap:26px;padding:0 22px;height:58px;
   background:var(--panel);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5}
 .brand{display:flex;align-items:center;gap:9px;font-weight:700;letter-spacing:-.02em;font-size:17px;color:var(--ink)}
 .brand .dot{width:9px;height:9px;border-radius:2px;background:var(--up);box-shadow:0 0 10px var(--up)}
 .topbar nav{display:flex;gap:18px;font-size:14px}
 .topbar nav a{color:var(--dim);padding:4px 2px;border-bottom:2px solid transparent}
 .topbar nav a.on,.topbar nav a:hover{color:var(--ink);border-bottom-color:var(--accent)}
 .session{margin-left:auto;font-size:12px;color:var(--dim);display:flex;align-items:center;gap:7px}
 .session .live{width:7px;height:7px;border-radius:99px;background:var(--up)}

 .wrap{max-width:1080px;margin:0 auto;padding:26px 22px 72px}
 h2{font-size:13px;text-transform:uppercase;letter-spacing:.1em;color:var(--dim);
    margin:0 0 12px;font-weight:600}
 .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
 .card .pad{padding:20px 22px}

 table{width:100%;border-collapse:collapse}
 th{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--dim);
    text-align:left;padding:11px 18px;background:var(--panel2);border-bottom:1px solid var(--line);font-weight:600}
 td{padding:14px 18px;border-bottom:1px solid var(--line)}
 tr:last-child td{border-bottom:0}
 tbody tr:hover{background:var(--panel2)}
 th.r,td.r{text-align:right}
 .tick{font-family:var(--mono);font-weight:700;letter-spacing:-.02em}
 .co{color:var(--dim);font-size:13px}
 .up{color:var(--up)} .down{color:var(--down)}
 .spark{display:block}

 .cols{display:grid;grid-template-columns:1fr;gap:20px}
 @media(min-width:900px){.cols{grid-template-columns:1.35fr .95fr;align-items:start}}

 .quote{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap}
 .big{font-family:var(--mono);font-size:38px;font-weight:700;letter-spacing:-.02em;line-height:1.1}
 .stat{display:flex;gap:26px;margin-top:18px;padding-top:16px;border-top:1px solid var(--line);flex-wrap:wrap}
 .stat div span{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--dim);margin-bottom:3px}
 .stat div p{margin:0;font-family:var(--mono);font-size:16px;font-weight:600}

 label{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.07em;
   color:var(--dim);margin:0 0 7px;font-weight:600}
 input{font:inherit;font-family:var(--mono);font-size:17px;padding:12px 14px;width:100%;
   border:1px solid var(--line);border-radius:9px;background:var(--bg);color:var(--ink)}
 input:focus{outline:2px solid var(--accent);outline-offset:1px}
 .btns{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px}
 button{font:inherit;font-weight:700;font-size:15px;padding:13px 10px;border-radius:9px;cursor:pointer;
   border:1px solid transparent;letter-spacing:.02em}
 #buy{background:var(--up);color:#04140B}
 #sell{background:transparent;color:var(--down);border-color:var(--down)}
 button:hover{filter:brightness(1.08)}

 .msg{margin:14px 0 0;padding:12px 14px;border-radius:9px;font-size:14px;font-weight:600}
 .err{background:color-mix(in srgb,var(--down) 14%,transparent);color:var(--down)}
 .ok{background:color-mix(in srgb,var(--up) 14%,transparent);color:var(--up)}

 .bar{height:6px;border-radius:99px;background:var(--line);overflow:hidden;margin-top:6px}
 .bar i{display:block;height:100%;background:var(--accent)}
 .foot{margin-top:26px;font-size:12px;color:var(--dim);text-align:center}
</style></head><body>
<div class="topbar">
  <div class="brand"><span class="dot"></span>Bellweather</div>
  <nav>${nav("/", "Markets")}${nav("/portfolio", "Portfolio", "portfolio-link")}</nav>
  <div class="session"><span class="live"></span>Paper account · GBP</div>
</div>
<div class="wrap">${body}
<p class="foot">Paper trading demo. No real orders are placed.</p>
</div></body></html>`;
}

const market = () => {
  const rows = MARKET.map((s) => {
    const t = TAPE[s.ticker];
    const up = t.change >= 0;
    return `<tr>
      <td><a href="/trade/${s.ticker}" id="link-${s.ticker}" class="tick">${s.ticker}</a>
          <div class="co">${esc(s.name)}</div></td>
      <td>${spark(t.series, up)}</td>
      <td class="r num">${money(s.price)}</td>
      <td class="r num ${up ? "up" : "down"}">${pct(t.change)}</td>
    </tr>`;
  }).join("");

  return page("Market", `
    <h2>Markets</h2>
    <div class="card">
      <table>
        <thead><tr><th>Instrument</th><th>Last 12</th><th class="r">Price</th><th class="r">Change</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`, "Markets");
};

function tradePage(account, ticker, { errors = {}, values = {}, done = "", now = Date.now() } = {}) {
  const s = findStock(ticker);
  if (!s) return null;
  const held = account.holdings[s.ticker] || 0;
  const t = TAPE[s.ticker];
  const up = t.change >= 0;
  const errorFor = (k) =>
    errors[k] ? `<p class="msg err" id="err-${k}">${esc(errors[k])}</p>` : "";

  return page(`Trade ${s.ticker}`, `
    <div class="cols">
      <div>
        <h2>${esc(s.name)}</h2>
        <div class="card"><div class="pad">
          <div class="quote">
            <div>
              <div class="tick" style="font-size:14px;color:var(--dim)">${s.ticker} · LSE</div>
              <p class="big" id="price">Price: ${money(s.price)}</p>
              <p class="num ${up ? "up" : "down"}" style="margin:2px 0 0">${pct(t.change)} today</p>
            </div>
            ${spark(t.series, up)}
          </div>
          <div class="stat">
            <div><span>Buying power</span><p class="num" id="cash">Cash: ${money(account.cash)}</p></div>
            <div><span>Position</span><p class="num" id="held">You hold: ${held} ${s.ticker}</p></div>
            <div><span>Quote expires</span><p class="num">60s</p></div>
          </div>
        </div></div>
      </div>

      <div>
        <h2>Order ticket</h2>
        <div class="card"><div class="pad">
          <form method="POST" action="/order">
            <input type="hidden" name="ticker" value="${s.ticker}">
            <input type="hidden" name="quotedAt" value="${now}">
            <label for="quantity">Number of shares</label>
            <input id="quantity" name="quantity" value="${esc(values.quantity ?? "1")}" inputmode="numeric">
            ${errorFor("quantity")}
            <div class="btns">
              <button type="submit" name="side" value="buy" id="buy">Buy</button>
              <button type="submit" name="side" value="sell" id="sell">Sell</button>
            </div>
          </form>
          ${done ? `<p class="msg ok" id="confirmation">${esc(done)}</p>` : ""}
          ${errorFor("cash")}${errorFor("holdings")}${errorFor("quote")}${errorFor("side")}
        </div></div>
      </div>
    </div>`, "Markets");
}

function portfolio(account) {
  const held = Object.entries(account.holdings).filter(([, q]) => q > 0);
  const value = held.reduce((sum, [t, q]) => sum + orderTotal(findStock(t).price, q), 0);
  const total = account.cash + value;

  const rows = held.length
    ? held.map(([t, q]) => {
        const st = findStock(t);
        const v = orderTotal(st.price, q);
        const share = total ? Math.round((v / total) * 100) : 0;
        return `<tr>
          <td><span class="tick">${t}</span><div class="co">${esc(st.name)}</div></td>
          <td class="r num">${q}</td>
          <td class="r num">${money(v)}
            <div class="bar"><i style="width:${share}%"></i></div></td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="3" id="no-holdings" style="color:var(--dim)">You hold no shares.</td></tr>`;

  return page("Portfolio", `
    <h2>Portfolio</h2>
    <div class="card"><div class="pad">
      <div class="stat" style="border-top:0;padding-top:0;margin-top:0">
        <div><span>Cash</span><p class="num" id="cash">Cash: ${money(account.cash)}</p></div>
        <div><span>Holdings</span><p class="num" id="total-value">Holdings value: ${money(value)}</p></div>
        <div><span>Account total</span><p class="num">${money(total)}</p></div>
      </div>
    </div></div>
    <div class="card" style="margin-top:20px">
      <table>
        <thead><tr><th>Instrument</th><th class="r">Shares</th><th class="r">Value</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`, "Portfolio");
}

/**
 * Route one request.
 *
 * Returns `{ status, html, account }`. Redirects are not used: a serverless
 * response and a Node response disagree about how to carry a cookie through a
 * 303, and the flows only ever read the page that comes back.
 */
export function handle({ method, path, form = {}, account, now = Date.now() }) {
  const acct = { cash: account.cash, holdings: { ...account.holdings } };

  if (method === "GET" && path === "/") return { status: 200, html: market(), account: acct };
  if (method === "GET" && path === "/portfolio") return { status: 200, html: portfolio(acct), account: acct };

  if (method === "GET" && path.startsWith("/trade/")) {
    const html = tradePage(acct, path.split("/")[2], { now });
    return html
      ? { status: 200, html, account: acct }
      : { status: 404, html: page("Not found", "<p>No such stock.</p>"), account: acct };
  }

  if (method === "POST" && path === "/order") {
    const stock = findStock(form.ticker);
    const check = validateOrder({
      side: form.side,
      stock,
      quantity: form.quantity,
      cashPence: acct.cash,
      holdings: acct.holdings,
      quotedAt: Number(form.quotedAt) || 0,
      now,
    });

    if (!check.ok) {
      const html = tradePage(acct, form.ticker, { errors: check.errors, values: form, now });
      return html
        ? { status: 200, html, account: acct }
        : { status: 404, html: page("Not found", "<p>No such stock.</p>"), account: acct };
    }

    const qty = Number(form.quantity);
    const total = orderTotal(stock.price, qty);
    if (form.side === "buy") {
      acct.cash -= total;
      acct.holdings[stock.ticker] = (acct.holdings[stock.ticker] || 0) + qty;
    } else {
      acct.cash += total;
      acct.holdings[stock.ticker] = (acct.holdings[stock.ticker] || 0) - qty;
    }

    const verb = form.side === "buy" ? "Bought" : "Sold";
    return {
      status: 200,
      html: tradePage(acct, form.ticker, { done: `${verb} ${qty} ${stock.ticker} for ${money(total)}.`, now }),
      account: acct,
    };
  }

  return { status: 404, html: page("Not found", "<p>Page not found.</p>"), account: acct };
}

/**
 * The account travels in a cookie so no server holds state.
 *
 * Signed, because an unsigned cookie lets a visitor edit their own balance —
 * which would look exactly like the fault the suite is supposed to catch, and
 * make the live demo lie about which checks work.
 */
export function encodeAccount(account, secret, hmac) {
  const body = Buffer.from(JSON.stringify(account)).toString("base64url");
  return `${body}.${hmac(body, secret)}`;
}

export function decodeAccount(cookie, secret, hmac) {
  if (!cookie) return newAccount();
  const [body, sig] = String(cookie).split(".");
  if (!body || !sig || hmac(body, secret) !== sig) return newAccount();
  try {
    const a = JSON.parse(Buffer.from(body, "base64url").toString());
    if (typeof a?.cash !== "number" || typeof a?.holdings !== "object") return newAccount();
    return a;
  } catch {
    return newAccount();
  }
}

export const parseCookies = (header) =>
  Object.fromEntries(String(header || "").split(";")
    .map((c) => c.trim().split("=")).filter((p) => p[0] && p[1]));
