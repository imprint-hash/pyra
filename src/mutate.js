/**
 * Light a match, see if the alarm goes off.
 *
 * A passing test suite tells you nothing on its own — it may be watching
 * closely, or it may be asleep. The only way to find out is to break the app
 * on purpose and see whether the suite notices.
 *
 * Each mutation below is a failure a real broker has shipped: a balance check
 * that stopped running, a total that lost its multiplier, a short-sale guard
 * that let you sell shares you never held. If a flow still passes with one of
 * these applied, that flow is decoration.
 *
 * Mutations rewrite app/logic.js only, and are always reverted — see
 * withMutation().
 */

import { readFile, writeFile } from "node:fs/promises";

export const MUTATIONS = [
  {
    id: "spend-beyond-balance",
    describes: "You can buy shares with money you do not have.",
    severity: "critical",
    find: `  return totalPence <= cashPence;`,
    replace: `  return true; // mutated: balance check removed`,
  },
  {
    id: "sell-shares-not-held",
    describes: "You can sell shares you never owned.",
    severity: "critical",
    find: `  const held = holdings[ticker] || 0;
  return quantity <= held;`,
    replace: `  return true; // mutated: holdings check removed`,
  },
  {
    id: "total-ignores-quantity",
    describes: "A 100-share order is charged as one share.",
    severity: "critical",
    find: `  return price * quantity;`,
    replace: `  return price; // mutated: quantity dropped from the total`,
  },
  {
    id: "negative-quantity-allowed",
    describes: "You can order minus fifty shares.",
    severity: "major",
    find: `  if (n <= 0) return { ok: false, reason: "Quantity must be at least 1." };`,
    replace: `  // mutated: positive-quantity check removed`,
  },
  {
    id: "fractional-shares-allowed",
    describes: "You can order 2.5 shares of a whole-share instrument.",
    severity: "minor",
    find: `  if (!Number.isInteger(n)) return { ok: false, reason: "Quantity must be a whole number." };`,
    replace: `  if (Number.isNaN(n)) return { ok: false, reason: "Quantity must be a whole number." }; // mutated`,
  },
  {
    id: "stale-price-accepted",
    describes: "Orders fill at a price that expired long ago.",
    severity: "major",
    find: `  return now - quotedAt <= QUOTE_TTL_MS;`,
    replace: `  return true; // mutated: quote expiry ignored`,
  },
];

/**
 * Run `fn` with one mutation applied, then always put the file back.
 *
 * The restore lives in `finally` because a crash mid-sweep that left a
 * mutation on disk would silently poison every later result — and worse,
 * would leave the developer's own app broken.
 */
export async function withMutation(logicPath, mutation, fn) {
  const original = await readFile(logicPath, "utf8");

  if (!original.includes(mutation.find)) {
    throw new Error(
      `mutation "${mutation.id}" no longer matches app/logic.js — ` +
      `the code it targets has changed, so the result would be meaningless`
    );
  }

  await writeFile(logicPath, original.replace(mutation.find, mutation.replace));
  try {
    return await fn();
  } finally {
    await writeFile(logicPath, original);
  }
}

/** Confirm every mutation still applies, before spending anything on runs. */
export async function checkAll(logicPath) {
  const src = await readFile(logicPath, "utf8");
  return MUTATIONS.map((m) => ({
    id: m.id,
    applies: src.includes(m.find),
    severity: m.severity,
    describes: m.describes,
  }));
}
