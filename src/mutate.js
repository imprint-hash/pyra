/**
 * Light a match, see if the alarm goes off.
 *
 * A passing test suite tells you nothing on its own — it may be watching
 * closely, or it may be asleep. The only way to find out is to break the app
 * on purpose and see whether the suite notices.
 *
 * Each mutation below is a bug someone has actually shipped: a validation that
 * stopped running, a total that lost its multiplier, a stock check that let
 * an out-of-stock item through. If a flow still passes with one of these
 * applied, that flow is decoration.
 *
 * Mutations rewrite app/logic.js only, and are always reverted — see apply().
 */

import { readFile, writeFile } from "node:fs/promises";

export const MUTATIONS = [
  {
    id: "email-validation-off",
    describes: "Checkout accepts any email address, even 'nonsense'.",
    find: `if (!email || !/^[^@\\s]+@[^@\\s]+\\.[^@\\s]{2,}$/.test(email)) errors.email = "Enter a valid email address.";`,
    replace: `// mutated: email validation removed`,
  },
  {
    id: "total-ignores-quantity",
    describes: "Basket total charges for one of everything, whatever the quantity.",
    find: `return lines.reduce((sum, l) => sum + l.price * l.quantity, 0);`,
    replace: `return lines.reduce((sum, l) => sum + l.price, 0); // mutated: quantity dropped`,
  },
  {
    id: "out-of-stock-sellable",
    describes: "Out-of-stock items can be added to the basket.",
    find: `if (item.stock <= 0) return { ok: false, reason: "Out of stock." };`,
    replace: `// mutated: stock check removed`,
  },
  {
    id: "any-code-discounts",
    describes: "Every discount code works, not just SAVE10.",
    find: `if (code.trim().toUpperCase() === "SAVE10") {`,
    replace: `if (true) { // mutated: any code accepted`,
  },
  {
    id: "card-length-unchecked",
    describes: "A two-digit card number is accepted as valid.",
    find: `if (!/^\\d{16}$/.test(digits)) errors.card = "Card number must be 16 digits.";`,
    replace: `if (!/^\\d{2,}$/.test(digits)) errors.card = "Card number must be 16 digits."; // mutated`,
  },
  {
    id: "empty-basket-orderable",
    describes: "An empty basket can be ordered.",
    find: `return Array.isArray(lines) && lines.length > 0;`,
    replace: `return true; // mutated: empty-basket guard removed`,
  },
];

/**
 * Run `fn` with one mutation applied, then always put the file back.
 *
 * The restore lives in `finally` because a crash mid-sweep that left a
 * mutation on disk would silently poison every later result — and worse,
 * would leave the developer's own shop broken.
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
    describes: m.describes,
  }));
}
