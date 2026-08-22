/**
 * The shop under test.
 *
 * Deliberately boring plumbing: no dependencies, no build step, one command to
 * run. The interesting file is logic.js — this one only renders what those
 * rules decide, so a mutation shows up as changed behaviour in the browser
 * rather than as a crash.
 *
 *   node app/server.js          → http://localhost:4321
 *
 * The basket lives in memory, keyed by a cookie, because a database would add
 * a second thing that can break and prove nothing about the idea.
 */

import http from "node:http";
import { CATALOGUE, findItem, money, canAddToCart, cartTotal,
         applyDiscount, validateCheckout, canPlaceOrder } from "./logic.js";

const PORT = Number(process.env.PORT || 4321);
const baskets = new Map();

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Kettle &amp; Co</title>
<style>
 :root{--ink:#1b1a24;--paper:#faf8f5;--line:#e0dcd4;--accent:#1f6f5c;--bad:#b3261e}
 @media(prefers-color-scheme:dark){:root{--ink:#f0eee9;--paper:#16151c;--line:#33313d;--accent:#4fbf9f;--bad:#ff8a80}}
 *{box-sizing:border-box}
 body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 ui-sans-serif,system-ui,sans-serif}
 .wrap{max-width:760px;margin:0 auto;padding:28px 20px 64px}
 header{display:flex;gap:18px;align-items:baseline;border-bottom:2px solid var(--line);padding-bottom:14px;margin-bottom:26px}
 h1{font-size:20px;margin:0}
 a{color:var(--accent)}
 .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:16px}
 .card{border:1px solid var(--line);border-radius:12px;padding:16px;background:transparent}
 .price{font-weight:600;font-variant-numeric:tabular-nums}
 button,.btn{font:inherit;font-weight:600;padding:10px 16px;border-radius:9px;border:1px solid var(--accent);
   background:var(--accent);color:#fff;cursor:pointer;text-decoration:none;display:inline-block}
 button[disabled]{opacity:.45;cursor:not-allowed}
 input{font:inherit;padding:9px 11px;border:1px solid var(--line);border-radius:9px;width:100%;
   background:var(--paper);color:var(--ink)}
 label{display:block;margin:12px 0 4px;font-weight:600;font-size:14px}
 .err{color:var(--bad);font-size:14px;margin-top:4px}
 .note{border-left:3px solid var(--accent);padding-left:12px;margin:16px 0}
 table{width:100%;border-collapse:collapse}
 td,th{text-align:left;padding:9px 6px;border-bottom:1px solid var(--line)}
 .total{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums}
 .soldout{color:var(--bad);font-size:14px;font-weight:600}
</style></head><body><div class="wrap">
<header><h1><a href="/" style="text-decoration:none;color:inherit">Kettle &amp; Co</a></h1>
<a href="/cart" id="cart-link">Basket</a></header>
${body}</div></body></html>`;
}

const lines = (id) => baskets.get(id) || [];

function home() {
  const cards = CATALOGUE.map((p) => `
    <div class="card">
      <h2 style="font-size:17px;margin:0 0 6px">${esc(p.name)}</h2>
      <p class="price">${money(p.price)}</p>
      ${p.stock > 0
        ? `<p style="font-size:14px;color:#7a7a7a">${p.stock} in stock</p>`
        : `<p class="soldout">Out of stock</p>`}
      <a class="btn" href="/product/${p.id}">View</a>
    </div>`).join("");
  return page("Home", `<div class="grid">${cards}</div>`);
}

function product(id, message = "") {
  const p = findItem(id);
  if (!p) return null;
  const disabled = p.stock <= 0 ? "disabled" : "";
  return page(p.name, `
    <h2>${esc(p.name)}</h2>
    <p class="price" id="price">${money(p.price)}</p>
    ${p.stock > 0 ? `<p>${p.stock} in stock</p>` : `<p class="soldout" id="stock">Out of stock</p>`}
    ${message ? `<p class="err" id="message">${esc(message)}</p>` : ""}
    <form method="POST" action="/add">
      <input type="hidden" name="id" value="${esc(p.id)}">
      <label for="qty">Quantity</label>
      <input id="qty" name="qty" value="1" inputmode="numeric" style="max-width:110px">
      <p><button type="submit" id="add-to-basket" ${disabled}>Add to basket</button></p>
    </form>
    <p><a href="/">Back to shop</a></p>`);
}

function cart(id, discountMsg = "", code = "") {
  const ls = lines(id);
  if (!ls.length) {
    return page("Basket", `<h2>Basket</h2><p id="empty">Your basket is empty.</p>
      <p><a href="/">Back to shop</a></p>`);
  }
  const raw = cartTotal(ls);
  const { total, message } = applyDiscount(raw, code);
  const rows = ls.map((l) => `<tr><td>${esc(l.name)}</td><td>${l.quantity}</td>
      <td class="price">${money(l.price * l.quantity)}</td></tr>`).join("");
  return page("Basket", `
    <h2>Basket</h2>
    <table><thead><tr><th>Item</th><th>Qty</th><th>Price</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="total" id="total">Total: ${money(total)}</p>
    ${message || discountMsg ? `<p class="err" id="discount-message">${esc(message || discountMsg)}</p>` : ""}
    <form method="POST" action="/discount">
      <label for="code">Discount code</label>
      <input id="code" name="code" value="${esc(code)}" style="max-width:200px">
      <p><button type="submit" id="apply-code">Apply code</button></p>
    </form>
    <p><a class="btn" href="/checkout" id="checkout-link">Checkout</a></p>`);
}

function checkout(id, errors = {}, values = {}) {
  const ls = lines(id);
  if (!canPlaceOrder(ls)) {
    return page("Checkout", `<h2>Checkout</h2>
      <p class="err" id="blocked">Your basket is empty, so there is nothing to order.</p>
      <p><a href="/">Back to shop</a></p>`);
  }
  const field = (name, label, type = "text") => `
    <label for="${name}">${label}</label>
    <input id="${name}" name="${name}" type="${type}" value="${esc(values[name] || "")}">
    ${errors[name] ? `<p class="err" id="err-${name}">${esc(errors[name])}</p>` : ""}`;
  return page("Checkout", `
    <h2>Checkout</h2>
    <p class="total">Total: ${money(cartTotal(ls))}</p>
    <form method="POST" action="/place-order">
      ${field("name", "Full name")}
      ${field("email", "Email address", "email")}
      ${field("card", "Card number")}
      <p><button type="submit" id="place-order">Place order</button></p>
    </form>`);
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
const redirect = (res, to) => { res.writeHead(303, { location: to }); res.end(); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const sid = sessionOf(req, res);
  const path = url.pathname;

  if (req.method === "GET" && path === "/") return send(res, home());

  if (req.method === "GET" && path.startsWith("/product/")) {
    const html = product(path.split("/")[2], url.searchParams.get("m") || "");
    return html ? send(res, html) : send(res, page("Not found", "<p>No such product.</p>"), 404);
  }

  if (req.method === "POST" && path === "/add") {
    const form = await readBody(req);
    const item = findItem(form.id);
    const qty = Number.parseInt(form.qty, 10);
    const verdict = canAddToCart(item, Number.isNaN(qty) ? 0 : qty);
    if (!verdict.ok) {
      return redirect(res, `/product/${form.id}?m=${encodeURIComponent(verdict.reason)}`);
    }
    const ls = lines(sid);
    const existing = ls.find((l) => l.id === item.id);
    if (existing) existing.quantity += qty;
    else ls.push({ id: item.id, name: item.name, price: item.price, quantity: qty });
    baskets.set(sid, ls);
    return redirect(res, "/cart");
  }

  if (req.method === "GET" && path === "/cart") return send(res, cart(sid));

  if (req.method === "POST" && path === "/discount") {
    const form = await readBody(req);
    return send(res, cart(sid, "", form.code || ""));
  }

  if (req.method === "GET" && path === "/checkout") return send(res, checkout(sid));

  if (req.method === "POST" && path === "/place-order") {
    const form = await readBody(req);
    if (!canPlaceOrder(lines(sid))) return send(res, checkout(sid));
    const { ok, errors } = validateCheckout(form);
    if (!ok) return send(res, checkout(sid, errors, form));
    baskets.delete(sid);
    return send(res, page("Order placed", `
      <h2 id="confirmation">Thank you — your order is placed.</h2>
      <p>We have emailed a receipt to ${esc(form.email)}.</p>
      <p><a href="/">Back to shop</a></p>`));
  }

  send(res, page("Not found", "<p>Page not found.</p>"), 404);
});

server.listen(PORT, () => console.log(`Kettle & Co on http://localhost:${PORT}`));
