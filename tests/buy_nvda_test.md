---
url: http://localhost:4321/trade/NVDA
---

## Order two shares of Nvidia

Type "2" into the "Number of shares" field.
Click the "Buy" button.

## Verify purchase succeeded

Verify the page shows "Cash: £3315.00".
Verify the page shows "You hold: 2 NVDA".

## Attempt to buy more shares than cash allows

Clear the "Number of shares" field and type "10".
Click the "Buy" button.

## Verify insufficient cash error and that no order was placed

Verify the page shows "Not enough cash. This order costs £8425.00."
Verify the page shows "Cash: £3315.00".
Verify the page shows "You hold: 2 NVDA".
