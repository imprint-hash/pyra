/**
 * Every rule the broker enforces, in one file.
 *
 * The mutation engine rewrites this file and nothing else. Keeping the rules
 * here — rather than scattered through request handlers and templates — is
 * what makes a mutation a single honest edit ("this check no longer runs")
 * instead of a shotgun blast through the app that would fail for reasons
 * nobody could attribute.
 *
 * Each exported function guards a rule a real broker has failed to enforce:
 * buying beyond your balance, selling shares you never held, an order total
 * that forgets the quantity, a price accepted long after it expired.
 *
 * Prices are fixed rather than simulated. A test that has to allow for a
 * moving market cannot say whether it went red because the app broke or
 * because the number moved, and this whole project rests on that distinction.
 */

export const MARKET = [
  { ticker: "NVDA", name: "Nvidia",   price: 84250 },
  { ticker: "AAPL", name: "Apple",    price: 21980 },
  { ticker: "TSLA", name: "Tesla",    price: 30140 },
];

/** A quote is only good for a minute. */
export const QUOTE_TTL_MS = 60_000;

export const money = (pence) => `£${(pence / 100).toFixed(2)}`;

export const findStock = (t) =>
  MARKET.find((s) => s.ticker === String(t || "").toUpperCase()) || null;

/** Whole, positive share counts only. */
export function validateQuantity(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n)) return { ok: false, reason: "Quantity must be a whole number." };
  if (n <= 0) return { ok: false, reason: "Quantity must be at least 1." };
  return { ok: true, quantity: n };
}

/** What the order costs. */
export function orderTotal(price, quantity) {
  return price * quantity;
}

/** You cannot spend money you do not have. */
export function canAfford(cashPence, totalPence) {
  return totalPence <= cashPence;
}

/** You cannot sell shares you do not hold. */
export function canSell(holdings, ticker, quantity) {
  const held = holdings[ticker] || 0;
  return quantity <= held;
}

/** A price older than the quote window must not be traded on. */
export function isQuoteFresh(quotedAt, now = Date.now()) {
  return now - quotedAt <= QUOTE_TTL_MS;
}

/**
 * The whole order, checked in one place.
 * Returns the reasons a shopper would be shown, not codes.
 */
export function validateOrder({ side, stock, quantity, cashPence, holdings, quotedAt, now }) {
  const errors = {};

  if (side !== "buy" && side !== "sell") errors.side = "Choose buy or sell.";
  if (!stock) errors.ticker = "No such stock.";

  const q = validateQuantity(quantity);
  if (!q.ok) errors.quantity = q.reason;

  if (!errors.ticker && !errors.quantity) {
    const total = orderTotal(stock.price, q.quantity);

    if (!isQuoteFresh(quotedAt, now)) {
      errors.quote = "That price has expired. Refresh and try again.";
    }
    if (side === "buy" && !canAfford(cashPence, total)) {
      errors.cash = `Not enough cash. This order costs ${money(total)}.`;
    }
    if (side === "sell" && !canSell(holdings, stock.ticker, q.quantity)) {
      errors.holdings = `You only hold ${holdings[stock.ticker] || 0} ${stock.ticker}.`;
    }
  }

  return { ok: Object.keys(errors).length === 0, errors };
}
