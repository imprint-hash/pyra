/**
 * The broker, served locally.
 *
 * A thin wrapper: read the request, decode the account from its cookie, call
 * `handle()`, write the result back. All the behaviour lives in app.js so the
 * local server and the deployed function cannot drift apart — a flow that
 * passes here has to mean the same thing against the live URL.
 *
 *   node app/server.js
 */

import http from "node:http";
import { createHmac } from "node:crypto";
import { handle, decodeAccount, encodeAccount, parseCookies } from "./app.js";

const PORT = Number(process.env.PORT || 4321);
const SECRET = process.env.SESSION_SECRET || "pyra-local-demo";

const hmac = (body, secret) =>
  createHmac("sha256", secret).update(body).digest("base64url").slice(0, 24);

const readBody = (req) =>
  new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(Object.fromEntries(new URLSearchParams(b))));
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const cookies = parseCookies(req.headers.cookie);
  const account = decodeAccount(cookies.acct, SECRET, hmac);
  const form = req.method === "POST" ? await readBody(req) : {};

  const out = handle({ method: req.method, path: url.pathname, form, account });

  res.writeHead(out.status, {
    "content-type": "text/html; charset=utf-8",
    "set-cookie": `acct=${encodeAccount(out.account, SECRET, hmac)}; Path=/; SameSite=Lax`,
  });
  res.end(out.html);
});

server.listen(PORT, () => console.log(`Bellweather on http://localhost:${PORT}`));
