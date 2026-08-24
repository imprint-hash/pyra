---
test: ../buy_nvda_test.md
status: passed
started: 2026-08-24T12:49:07.926Z
duration_s: 60
session_id: cb206ba7-e7c3-4ff7-a6a0-52c20fe91cfe
---

# buy_nvda_test.md — Result

## Order two shares of Nvidia ✓ passed (11.48s)
md5: 67dd7ed66e03858fea46c86cc7712e59
Type "2" into the "Number of shares" field.
Click the "Buy" button.

## Verify purchase succeeded ✓ passed (1.59s)
md5: 03bfd0a70e2846bd277b7e8b38a1731f
Verify the page shows "Cash: £3315.00".
Verify the page shows "You hold: 2 NVDA".

## Attempt to buy more shares than cash allows ✓ passed (1.28s)
md5: 834830affaf0f43edb410e02799c0748
Clear the "Number of shares" field and type "10".
Click the "Buy" button.

## Verify insufficient cash error and that no order was placed ✓ passed (38.3s)
md5: 964989313fd52221b11439e6a9ba1a59
Verify the page shows "Not enough cash. This order costs £8425.00."
Verify the page shows "Cash: £3315.00".
Verify the page shows "You hold: 2 NVDA".
