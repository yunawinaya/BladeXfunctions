# Putaway split: float residue in the split total (2026-10-20)

The Putaway form's split dialog refused a split whose boxes add up to the pending quantity. It compared the floating-point
sum for exact equality: 30 boxes of 17.656 add up to 529.6800000000001, not 529.68. The user saw "Total store in quantity
must be equal to pending putaway quantity." This is the same bug as the GR split (`../2026-10-20-gr-split-tolerance/`,
Albatross GR/202610200001).

Fix: the split total is rounded to 8 dp, and the comparison with the pending quantity allows a difference up to 0.0005
(the GR split's tolerance). A split 0.001 or more off is still refused. Nothing else in the handler changed.

## Paste (prod)

Putaway form (`transfer_order_putaway`, prod v364) → event script `onClick_save_split` (key `crcf8voq`) → replace the
whole body with `onClick_save_split.prod.js`. The paste is built on prod v364's own handler, which is older than dev's,
not on dev's.

Dev is already fixed: Putaway form v368, published 2026-10-20 09:48 (mirror `Putaway/PutawayConfirmSplitDialog.js`). The
full deployment carries dev v368, so this paste matters only if prod needs the fix before that.

Tested with a harness (old vs new handler on a mocked form, for prod v364 and dev v367): 30 × 17.656 against 529.68 is
accepted (the old handler refused it); 0.01 over, and 0.001 over, are refused; an exact split, 0.0004 over, and a pending
quantity sent as text are accepted.
