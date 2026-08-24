---
test: ../buy_nvda_test.md
status: passed
started: 2026-08-24T08:11:29.066Z
duration_s: 96
session_id: 99e0ccfd-7dc0-4ab6-9af0-9a673900415c
---

# buy_nvda_test.md — Result

## Order two shares of Nvidia ✓ passed (1.98s)
md5: 67dd7ed66e03858fea46c86cc7712e59
Type "2" into the "Number of shares" field.
Click the "Buy" button.

## Verify purchase succeeded ✓ passed (28.3s)
md5: 03bfd0a70e2846bd277b7e8b38a1731f
Verify the page shows "Cash: £3315.00".
Verify the page shows "You hold: 2 NVDA".

## Attempt to buy more shares than cash allows ✓ passed (32.9s)
md5: 834830affaf0f43edb410e02799c0748
Clear the "Number of shares" field and type "10".
Click the "Buy" button.

## Verify insufficient cash error ✓ passed (26.6s)
md5: 9e36c37310bd98e3e4cfca974e72c186
Verify the page shows "Not enough cash. This order costs £8425.00."
