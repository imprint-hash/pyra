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

const esc = (s) => String(s).replace(/[<>&"]/g, (c) =>
  ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

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
 input{font:inherit;padding:9px 11px;border:1px solid var(--line);border-radius:9px;
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

const market = () => {
  const rows = MARKET.map((s) => `<tr>
      <td><a href="/trade/${s.ticker}" id="link-${s.ticker}">${s.ticker}</a></td>
      <td>${esc(s.name)}</td>
      <td class="num">${money(s.price)}</td>
    </tr>`).join("");
  return page("Market", `<h2>Market</h2>
    <table><thead><tr><th>Ticker</th><th>Name</th><th>Price</th></tr></thead>
    <tbody>${rows}</tbody></table>`);
};

function tradePage(account, ticker, { errors = {}, values = {}, done = "", now = Date.now() } = {}) {
  const s = findStock(ticker);
  if (!s) return null;
  const held = account.holdings[s.ticker] || 0;
  const errorFor = (k) => errors[k] ? `<p class="err" id="err-${k}">${esc(errors[k])}</p>` : "";

  return page(`Trade ${s.ticker}`, `
    <h2>${esc(s.name)} <span class="num">(${s.ticker})</span></h2>
    <p class="num" id="price">Price: ${money(s.price)}</p>
    <p class="num" id="cash">Cash: ${money(account.cash)}</p>
    <p class="num" id="held">You hold: ${held} ${s.ticker}</p>
    ${done ? `<p class="ok" id="confirmation">${esc(done)}</p>` : ""}
    ${errorFor("quote")}${errorFor("cash")}${errorFor("holdings")}${errorFor("side")}
    <form method="POST" action="/order">
      <input type="hidden" name="ticker" value="${s.ticker}">
      <input type="hidden" name="quotedAt" value="${now}">
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

function portfolio(account) {
  const held = Object.entries(account.holdings).filter(([, q]) => q > 0);
  const rows = held.length
    ? held.map(([t, q]) => {
        const s = findStock(t);
        return `<tr><td>${t}</td><td class="num">${q}</td>
          <td class="num">${money(orderTotal(s.price, q))}</td></tr>`;
      }).join("")
    : `<tr><td colspan="3" id="no-holdings">You hold no shares.</td></tr>`;
  const value = held.reduce((sum, [t, q]) => sum + orderTotal(findStock(t).price, q), 0);
  return page("Portfolio", `<h2>Portfolio</h2>
    <p class="cash num" id="cash">Cash: ${money(account.cash)}</p>
    <table><thead><tr><th>Ticker</th><th>Shares</th><th>Value</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p class="num" id="total-value">Holdings value: ${money(value)}</p>
    <p><a href="/">Back to market</a></p>`);
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
