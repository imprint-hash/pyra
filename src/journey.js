/**
 * The paid half: Kane actually shops.
 *
 * One objective per store, not one per stage. Every `kane-cli run` is a fresh
 * browser with a fresh plan, so splitting the journey would throw away the
 * cart between steps and bill us for each restart. Keeping it whole is both
 * cheaper and the only way the step count means anything.
 *
 * The run always stops before payment. We cannot complete an order on a store
 * we do not own, and pretending otherwise would put real card details into a
 * benchmark. "Reached the payment step" is the honest finish line.
 */

import { spawn } from "node:child_process";

/**
 * Turn what recon saw into wording Kane can act on.
 *
 * Kane works in the vocabulary of the page — it is told to click "Add to
 * basket", not to match a selector. Quoting the store's own button text is
 * what keeps it from inventing a control; guessing at "Add to Cart" on a shop
 * that says "Add to basket" is how our first runs died.
 */
export function buildObjective(site) {
  const wording = (patterns, fallback) => {
    const all = [...site.buttons.map((b) => b.text), ...site.links.map((l) => l.text)];
    return all.find((t) => patterns.some((p) => p.test(t))) || fallback;
  };

  const addLabel = wording([/add to (cart|bag|basket|trolley)/i, /buy now/i], "Add to Cart");
  const cartLabel = wording([/^(cart|bag|basket)$/i, /view (cart|bag|basket)/i], "Cart");

  return [
    "You are shopping on this store as an ordinary customer.",
    "Open any product that is in stock.",
    `Add it to the basket using the "${addLabel}" control.`,
    `Then open the "${cartLabel}" and proceed towards checkout.`,
    "Stop as soon as a payment or card-details step appears — do not enter any payment information and do not place the order.",
    "Store the name of the product you added as 'product'.",
    "Store the furthest stage you reached as 'stage_reached'.",
  ].join(" ");
}

/** Run one Kane objective and hand back its parsed NDJSON events. */
function runKane(objective, url, { maxSteps = 40, timeout = 420 } = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      "run", objective,
      "--url", url,
      "--headless",
      "--max-steps", String(maxSteps),
      "--timeout", String(timeout),
      // Kane's own bug detector separates "this shop is broken" from "my
      // automation slipped". That distinction is a scorecard row we would
      // otherwise have to invent, and it is far more credible coming from
      // the sponsor's engine than from ours.
      "--bug-detection", "continue",
      "--agent",
    ];

    const child = spawn("kane-cli", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (b) => (out += b));
    child.stderr.on("data", (b) => (err += b));
    child.on("error", reject);
    child.on("close", () => {
      const events = [];
      for (const line of out.split("\n")) {
        const t = line.trim();
        if (t.startsWith("{")) { try { events.push(JSON.parse(t)); } catch { /* progress noise */ } }
      }
      events.length ? resolve({ events, raw: out })
                    : reject(new Error(`no NDJSON from kane-cli. stderr: ${err.slice(0, 300)}`));
    });
  });
}

const STAGE_ORDER = ["landed", "product", "cart", "checkout", "payment"];

/** How far through buying something the run actually got. */
function stageReached(events, finalState) {
  const claimed = String(finalState?.stage_reached || "").toLowerCase();
  const hit = STAGE_ORDER.filter((s) => claimed.includes(s));
  if (hit.length) return hit[hit.length - 1];

  // Fall back to what the run narrated, since a store that never answers the
  // "store as" prompt still leaves a trail of what it did.
  const trail = events.map((e) => `${e.step || ""} ${e.remark || ""} ${e.summary || ""}`)
                      .join(" ").toLowerCase();
  let best = "landed";
  for (const s of STAGE_ORDER) {
    if (s === "payment" && /payment|card number|place order/.test(trail)) best = s;
    else if (s === "checkout" && /check\s?out/.test(trail)) best = s;
    else if (s === "cart" && /(cart|basket|bag)/.test(trail)) best = s;
    else if (s === "product" && /(product|item|add to)/.test(trail)) best = s;
  }
  return best;
}

export async function shop(site) {
  const objective = buildObjective(site);
  const started = Date.now();
  const { events } = await runKane(objective, site.entry || site.url);

  const end = events.find((e) => e.final_state !== undefined || e.verdict !== undefined) || {};
  const verdict = end.verdict || {};
  const finalState = end.final_state || {};

  // A step here is one thing Kane did on the page — the closest honest proxy
  // for "how much work the shopper had to do".
  const steps = events.filter((e) => e.step !== undefined).length;

  return {
    url: site.url,
    ok: end.status === "passed",
    status: end.status || "unknown",
    steps,
    stage: stageReached(events, finalState),
    product: finalState.product || null,
    // Only count a bug when Kane blames the shop, not itself. Its verdict
    // engine already draws that line, and our own runs proved how often the
    // fault is the automation's.
    siteBug: verdict.family && verdict.family !== "automation_bug"
      ? { title: verdict.bug_title, severity: verdict.severity, why: verdict.one_liner }
      : null,
    agentSlip: verdict.family === "automation_bug" ? verdict.one_liner : null,
    credits: Number(end.credits_consumed || 0),
    wallMs: Date.now() - started,
    reportUrl: end.test_url || null,
  };
}
