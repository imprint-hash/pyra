/**
 * Every rule the shop enforces, in one file.
 *
 * The mutation engine rewrites this file and nothing else. Keeping the rules
 * here — rather than scattered through request handlers and templates — is
 * what makes a mutation a single honest edit ("this validation no longer
 * runs") instead of a shotgun blast through the app that would fail for
 * reasons nobody could attribute.
 *
 * Each exported function is a place a real shop has shipped a real bug.
 */

export const CATALOGUE = [
  { id: "kettle", name: "Stovetop Kettle", price: 3400, stock: 6 },
  { id: "mug", name: "Speckled Mug", price: 1200, stock: 0 },
  { id: "grinder", name: "Hand Grinder", price: 5800, stock: 3 },
];

export const money = (pence) => `£${(pence / 100).toFixed(2)}`;

export const findItem = (id) => CATALOGUE.find((p) => p.id === id) || null;

/** Out-of-stock items must not reach the basket. */
export function canAddToCart(item, quantity) {
  if (!item) return { ok: false, reason: "No such product." };
  if (item.stock <= 0) return { ok: false, reason: "Out of stock." };
  if (quantity < 1) return { ok: false, reason: "Quantity must be at least 1." };
  if (quantity > item.stock) return { ok: false, reason: `Only ${item.stock} left.` };
  return { ok: true };
}

/** Line totals and the order total. */
export function cartTotal(lines) {
  return lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
}

/** SAVE10 takes 10% off. Anything else is rejected, loudly. */
export function applyDiscount(total, code) {
  if (!code) return { total, applied: false, message: "" };
  if (code.trim().toUpperCase() === "SAVE10") {
    return { total: Math.round(total * 0.9), applied: true, message: "SAVE10 applied — 10% off." };
  }
  return { total, applied: false, message: "That code is not valid." };
}

/** The checkout form's rules. */
export function validateCheckout({ name, email, card }) {
  const errors = {};
  if (!name || name.trim().length < 2) errors.name = "Enter your name.";
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) errors.email = "Enter a valid email address.";
  const digits = (card || "").replace(/\s/g, "");
  if (!/^\d{16}$/.test(digits)) errors.card = "Card number must be 16 digits.";
  return { ok: Object.keys(errors).length === 0, errors };
}

/** An empty basket cannot be ordered. */
export function canPlaceOrder(lines) {
  return Array.isArray(lines) && lines.length > 0;
}
