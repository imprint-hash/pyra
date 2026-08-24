---
test: ../buy_nvda_test.md
status: failed
started: 2026-08-24T07:41:52.732Z
duration_s: 89
session_id: b9d67020-11db-46e9-bf1d-a6d1c471abee
---

# buy_nvda_test.md — Result

## Order two shares of Nvidia ✓ passed (7.69s)
md5: 9566bce555a42056a3f395e40b0da771
Type "2" into the "Number of shares" field.  
Click the "Buy" button.

## Confirm the order was accepted ✓ passed (1.42s)
md5: 2a619d0646a2858aa6b6f1ad340fd30f
Verify the page shows a confirmation that 2 NVDA were bought.

## Open the portfolio ✓ passed (1.08s)
md5: a82836b6c4a029071bc3a600e16ff126
Click the "Portfolio" link.

## Confirm the shares are held ✓ passed (0.66s)
md5: 040eb3f7608ccdd2f0763407d9c87025
Verify the portfolio lists NVDA.

## Attempt to buy too many shares ✓ passed (3.3s)
md5: 986e0f5ca36f71cbf2f9a28cf9be8ca5
Type "7" into the "Number of shares" field.  
Click the "Buy" button.

## Verify insufficient cash error ✗ failed (42.6s)
md5: 24d6c157036b5fffaabfcab9c850bd76
Reason: Final verification failed: "the error message reads exactly: `Not enough cash. This order costs £5,897.50.`" — bug verdict: Insufficient cash error omits thousands separator [application_issue/ui_data_defect, confidence 0.96]
Check that the error message reads exactly:  
`Not enough cash. This order costs £5,897.50.`
