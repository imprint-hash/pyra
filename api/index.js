/**
 * The broker, served from a serverless function.
 *
 * Same `handle()` as the local server — the only difference is how a request
 * and a cookie are shaped. Nothing is held in memory between invocations,
 * which is why the account travels in a signed cookie rather than a Map.
 */

import { createHmac } from "node:crypto";
import { handle, decodeAccount, encodeAccount, parseCookies } from "../app/app.js";

const SECRET = process.env.SESSION_SECRET || "pyra-demo";

const hmac = (body, secret) =>
  createHmac("sha256", secret).update(body).digest("base64url").slice(0, 24);

const readBody = (req) =>
  new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(Object.fromEntries(new URLSearchParams(b))));
  });

export default async function handler(req, res) {
  const path = new URL(req.url, "http://x").pathname;
  const account = decodeAccount(parseCookies(req.headers.cookie).acct, SECRET, hmac);
  const form = req.method === "POST" ? await readBody(req) : {};

  const out = handle({ method: req.method, path, form, account });

  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("set-cookie", `acct=${encodeAccount(out.account, SECRET, hmac)}; Path=/; SameSite=Lax`);
  res.status(out.status).send(out.html);
}
