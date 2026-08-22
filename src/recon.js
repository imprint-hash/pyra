/**
 * Free reconnaissance.
 *
 * Kane charges for every action it takes, and it plans those actions from the
 * objective text alone — `kane-cli generate` is explicit that it works
 * "without launching a browser". Send it in blind and it invents a shop that
 * isn't there; four of our early runs died exactly that way, on assumptions
 * about a search box and a login form that did not match the real page.
 *
 * So we look first, with our own Chrome, for nothing. Only the journey itself
 * is worth paying for.
 */

import { spawn } from "node:child_process";

const CHROME =
  process.env.KANE_CLI_CHROME_PATH ||
  process.env.CHROME_PATH ||
  "/usr/bin/google-chrome";

/** Render a page and return its DOM after scripts have run. */
export function dumpDom(url, { timeoutMs = 45000, budgetMs = 9000 } = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      `--virtual-time-budget=${budgetMs}`,
      "--dump-dom",
      url,
    ];
    const child = spawn(CHROME, args, { stdio: ["ignore", "pipe", "ignore"] });

    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`timed out after ${timeoutMs}ms: ${url}`));
    }, timeoutMs);

    child.stdout.on("data", (b) => (out += b));
    child.on("error", reject);
    child.on("close", () => {
      clearTimeout(timer);
      out.length ? resolve(out) : reject(new Error(`empty DOM: ${url}`));
    });
  });
}

const strip = (s) =>
  s.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i"));
  return m ? m[1] : "";
}

/**
 * The things a shopper can act on.
 *
 * Buttons and links are kept with their visible text because that is the
 * vocabulary Kane actually works in — it is told to "click Add to Cart", not
 * to match a CSS selector. Handing it wording lifted from the live page is
 * what stops it inventing a control that does not exist.
 */
export function findControls(dom) {
  const links = [];
  for (const m of dom.matchAll(/<a\b([^>]*)>(.*?)<\/a>/gis)) {
    const text = strip(m[2]);
    const href = attr(m[1], "href");
    if (text && text.length < 60) links.push({ text, href });
  }

  const buttons = [];
  for (const m of dom.matchAll(/<button\b([^>]*)>(.*?)<\/button>/gis)) {
    const text = strip(m[2]) || attr(m[1], "aria-label");
    if (text) buttons.push({ text: text.slice(0, 60) });
  }
  // Submit inputs are buttons to a shopper even though the tag differs.
  for (const m of dom.matchAll(/<input\b([^>]*type\s*=\s*"(?:submit|button)"[^>]*)>/gi)) {
    const text = attr(m[1], "value") || attr(m[1], "aria-label");
    if (text) buttons.push({ text: text.slice(0, 60) });
  }

  const inputs = [];
  for (const m of dom.matchAll(/<input\b([^>]*)>/gi)) {
    const type = (attr(m[1], "type") || "text").toLowerCase();
    if (["submit", "button", "hidden"].includes(type)) continue;
    inputs.push({
      type,
      name: attr(m[1], "name") || attr(m[1], "id"),
      label: attr(m[1], "placeholder") || attr(m[1], "aria-label"),
    });
  }

  return { links, buttons, inputs };
}

/** Words a shop uses for each stage of buying something. */
const SIGNALS = {
  product: [/\badd to (cart|bag|basket)\b/i, /\bbuy now\b/i, /\badd to trolley\b/i],
  cart: [/\b(cart|bag|basket)\b/i],
  checkout: [/\bcheck\s?out\b/i, /\bproceed to (checkout|payment)\b/i],
  payment: [/\b(pay|payment|card number|place order|complete order)\b/i],
};

/**
 * Which stages of a purchase this page exposes.
 *
 * This is deliberately shallow: it reports what a shopper could reach from
 * here, so the journey we hand Kane is grounded in the page rather than in
 * our idea of what a shop looks like.
 */
export function detectStages({ links, buttons, inputs }) {
  const vocabulary = [
    ...links.map((l) => l.text),
    ...buttons.map((b) => b.text),
    ...inputs.map((i) => `${i.name} ${i.label}`),
  ].join(" | ");

  const found = {};
  for (const [stage, patterns] of Object.entries(SIGNALS)) {
    found[stage] = patterns.some((p) => p.test(vocabulary));
  }
  return found;
}

/**
 * Chrome renders its own error page when a site is unreachable, and that page
 * has a title, buttons and links like any other — so it parses cleanly as a
 * shop with no checkout. Left undetected, an unreachable competitor would
 * quietly score zero and look like a terrible store instead of a missing one.
 */
function isChromeErrorPage(dom, url) {
  const host = (() => { try { return new URL(url).host; } catch { return ""; } })();
  const title = (dom.match(/<title[^>]*>(.*?)<\/title>/is)?.[1] || "").trim();
  if (host && title === host) return true;          // Chrome titles errors with the host
  return /id="main-frame-error"|ERR_[A-Z_]{4,}|Checking the proxy and the firewall/.test(dom);
}

export async function recon(url) {
  const dom = await dumpDom(url);

  if (isChromeErrorPage(dom, url)) {
    const code = dom.match(/ERR_[A-Z_]{4,}/)?.[0] || "unreachable";
    return { url, reachable: false, error: code, stages: {}, links: [], buttons: [], inputs: [] };
  }

  const controls = findControls(dom);
  return {
    url,
    reachable: true,
    bytes: dom.length,
    title: (dom.match(/<title[^>]*>(.*?)<\/title>/is)?.[1] || "").trim(),
    ...controls,
    stages: detectStages(controls),
  };
}
