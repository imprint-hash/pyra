/**
 * The broker under test.
 *
 * Deliberately boring plumbing: no dependencies, no build step, one command to
 * run. The interesting file is logic.js — this one only renders what those
 * rules decide, so a mutation shows up as changed behaviour in a browser
 * rather than as a crash.
 *
 *   node app/server.js          → http://localhost:4321
 *
 * Accounts live in memory, keyed by a cookie. A database would add a second
 * thing that can break and would prove nothing about the idea.
 */

import http from "node:http";
import { MARKET, findStock, money, orderTotal, validateOrder } from "./logic.js";

const PORT = Number(process.env.PORT || 4321);
const OPENING_CASH = 5_000_00;
const accounts = new Map();

const esc = (s) => String(s).replace(/[<>&"]/g, (c) =>
  ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

function account(id) {
  if (!accounts.has(id)) accounts.set(id, { cash: OPENING_CASH, holdings: {} });
  return accounts.get(id);
}

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Bellweather</title>
<style>
 :root{--ink:#12141a;--paper:#f7f7f4;--line:#dcdcd6;--up:#0b7a54;--down:#b3261e;--accent:#1b4dd8}
 @media(prefers-color-scheme:dark){:root{--ink:#eceef2;--paper:#101218;--line:#2a2e39;--up:#37c58c;--down:#ff8a80;--accent:#7d9bff}}
 *{box-sizing:border-box}
 body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 ui-sans-serif,system-ui,sans-serif}
 .wrap{max-width:780px;margin:0 auto;padding:26px 20px 64px}
 header{display:flex;gap:20px;align-items:baseline;justify-content:space-between;
   border-bottom:2px solid var(--line);padding-bottom:14px;margin-bottom:24px}
 h1{font-size:19px;margin:0;letter-spacing:-.01em}
 a{color:var(--accent)}
 .num{font-variant-numeric:tabular-nums}
 table{width:100%;border-collapse:collapse}
 td,th{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line)}
 th{font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:#7d7d86}
 button{font:inherit;font-weight:600;padding:10px 18px;border-radius:9px;border:1px solid var(--accent);
   background:var(--accent);color:#fff;cursor:pointer}
 button.sell{background:transparent;color:var(--accent)}
 input,select{font:inherit;padding:9px 11px;border:1px solid var(--line);border-radius:9px;
   background:var(--paper);color:var(--ink)}
 label{display:block;margin:12px 0 4px;font-weight:600;font-size:14px}
 .err{color:var(--down);font-size:14px;margin-top:6px;font-weight:600}
 .ok{color:var(--up);font-weight:700}
 .cash{font-size:22px;font-weight:700}
</style></head><body><div class="wrap">
<header><h1><a href="/" style="text-decoration:none;color:inherit">Bellweather</a></h1>
<a href="/portfolio" id="portfolio-link">Portfolio</a></header>
${body}</div></body></html>`;
}

function market() {
  const rows = MARKET.map((s) => `<tr>
      <td><a href="/trade/${s.ticker}" id="link-${s.ticker}">${s.ticker}</a></td>
      <td>${esc(s.name)}</td>
      <td class="num">${money(s.price)}</td>
    </tr>`).join("");
  return page("Market", `<h2>Market</h2>
    <table><thead><tr><th>Ticker</th><th>Name</th><th>Price</th></tr></thead>
    <tbody>${rows}</tbody></table>`);
}

function tradePage(id, ticker, { errors = {}, values = {}, done = "" } = {}) {
  const s = findStock(ticker);
  if (!s) return null;
  const acct = account(id);
  const held = acct.holdings[s.ticker] || 0;
  const quotedAt = Date.now();

  const errorFor = (k) => errors[k] ? `<p class="err" id="err-${k}">${esc(errors[k])}</p>` : "";

  return page(`Trade ${s.ticker}`, `
    <h2>${esc(s.name)} <span class="num">(${s.ticker})</span></h2>
    <p class="num" id="price">Price: ${money(s.price)}</p>
    <p class="num" id="cash">Cash: ${money(acct.cash)}</p>
    <p class="num" id="held">You hold: ${held} ${s.ticker}</p>
    ${done ? `<p class="ok" id="confirmation">${esc(done)}</p>` : ""}
    ${errorFor("quote")}${errorFor("cash")}${errorFor("holdings")}${errorFor("side")}
    <form method="POST" action="/order">
      <input type="hidden" name="ticker" value="${s.ticker}">
      <input type="hidden" name="quotedAt" value="${quotedAt}">
      <label for="quantity">Number of shares</label>
      <input id="quantity" name="quantity" value="${esc(values.quantity ?? "1")}" inputmode="numeric" style="max-width:130px">
      ${errorFor("quantity")}
      <p style="display:flex;gap:10px;margin-top:16px">
        <button type="submit" name="side" value="buy" id="buy">Buy</button>
        <button type="submit" name="side" value="sell" id="sell" class="sell">Sell</button>
      </p>
    </form>
    <p><a href="/">Back to market</a></p>`);
}

function portfolio(id) {
  const acct = account(id);
  const held = Object.entries(acct.holdings).filter(([, q]) => q > 0);
  const rows = held.length
    ? held.map(([t, q]) => {
        const s = findStock(t);
        return `<tr><td>${t}</td><td class="num">${q}</td>
          <td class="num">${money(orderTotal(s.price, q))}</td></tr>`;
      }).join("")
    : `<tr><td colspan="3" id="no-holdings">You hold no shares.</td></tr>`;
  const value = held.reduce((sum, [t, q]) => sum + orderTotal(findStock(t).price, q), 0);
  return page("Portfolio", `<h2>Portfolio</h2>
    <p class="cash num" id="cash">Cash: ${money(acct.cash)}</p>
    <table><thead><tr><th>Ticker</th><th>Shares</th><th>Value</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p class="num" id="total-value">Holdings value: ${money(value)}</p>
    <p><a href="/">Back to market</a></p>`);
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(Object.fromEntries(new URLSearchParams(b))));
  });
}

function sessionOf(req, res) {
  const jar = Object.fromEntries((req.headers.cookie || "").split(";")
    .map((c) => c.trim().split("=")).filter((p) => p[0]));
  let id = jar.sid;
  if (!id) {
    id = Math.random().toString(36).slice(2);
    res.setHeader("Set-Cookie", `sid=${id}; Path=/; SameSite=Lax`);
  }
  return id;
}

const send = (res, html, code = 200) => {
  res.writeHead(code, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const sid = sessionOf(req, res);
  const path = url.pathname;

  if (req.method === "GET" && path === "/") return send(res, market());
  if (req.method === "GET" && path === "/portfolio") return send(res, portfolio(sid));

  if (req.method === "GET" && path.startsWith("/trade/")) {
    const html = tradePage(sid, path.split("/")[2]);
    return html ? send(res, html) : send(res, page("Not found", "<p>No such stock.</p>"), 404);
  }

  if (req.method === "POST" && path === "/order") {
    const form = await readBody(req);
    const stock = findStock(form.ticker);
    const acct = account(sid);

    const check = validateOrder({
      side: form.side,
      stock,
      quantity: form.quantity,
      cashPence: acct.cash,
      holdings: acct.holdings,
      quotedAt: Number(form.quotedAt) || 0,
      now: Date.now(),
    });

    if (!check.ok) {
      const html = tradePage(sid, form.ticker, { errors: check.errors, values: form });
      return html ? send(res, html) : send(res, page("Not found", "<p>No such stock.</p>"), 404);
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
    return send(res, tradePage(sid, form.ticker, {
      done: `${verb} ${qty} ${stock.ticker} for ${money(total)}.`,
    }));
  }

  send(res, page("Not found", "<p>Page not found.</p>"), 404);
});

server.listen(PORT, () => console.log(`Bellweather on http://localhost:${PORT}`));
