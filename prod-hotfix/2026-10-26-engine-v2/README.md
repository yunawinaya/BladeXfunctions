# 2026-10-26 INVENTORY_APPLY_OPERATION: the price fix, and the take-order fix done right (tested at 200 keys)

> **PASTED ~12:05 (user's choice: both fixes):** prod v14 is IDENTICAL to `INVENTORY_APPLY_OPERATION.json`. First real large
> operation on it: LSH PKG|2114570881056509953|1, 40 keys, one TAKE (3.6 s) and one GIVE (3.7 s), all 40 keys back at
> token 1.

**Paste into: INVENTORY_APPLY_OPERATION (id 2105133980371554305).** Prod live before: v12, rolled back today. Pick ONE file:

| File | What it changes vs prod v12 | Tested on dev |
|---|---|---|
| `INVENTORY_APPLY_OPERATION.price_only.json` | Price fix only. The checks compare stored decimals at the tenant's rule (no more GUB-type false review). Take and give-back lanes are byte-identical to v12. | dev v16: 100-line GD, **200 keys**, TAKE 10 calls / GIVE 10 calls, DONE/OK, all checks OK (run 2114565225200275458) |
| `INVENTORY_APPLY_OPERATION.json` | Price fix **plus** take-order fix. TAKE and give-back each run as ONE call in lock order. | dev v17: same 100-line GD, **200 keys**, TAKE 1 call (9.4 s) / GIVE 1 call (13.2 s), DONE/OK, all 200 keys back at token 1, nothing stuck |

After the paste: `.dbtools/wf --prod deployed "prod-hotfix/2026-10-26-engine-v2/<file>"` must say IDENTICAL. Then the GD
session watches the first large operations (more than 25 keys) to their give-back.

## Why the take-order fix is safe now (and v13 was not)
v13 made only the TAKE one call; its give-back still ran in lanes. Prod shows which calls can release which keys (the
platform keeps a key's atomic-count lock until the top-level run ends):
- **main take + main give:** works. Every operation with 25 keys or fewer, always.
- **laned take + laned give, same split:** works (v12 DONE path).
- **laned take + one main give:** works (v12 REJECT path: GD|2114499739281133569|15, 63 keys in one call, 6.1 s).
- **main take + laned give:** FROZE (v13, 11:06-11:39).

This file puts both on the main path. `scratchpad/gdc/gdcreate/test/test_one_stock_call.js` now fails if the take and the
give-back ever split differently; it fails on v13. The RECOVER and REJECT gives were already one main call.

**What it prevents:** with one ascending take per operation, no lane can wait on a key while another lane of the same
operation holds a later one. That was the 07:31-07:51 freeze.

**Cost:** on dev (2-7x slower than prod) 200 keys took about 9 s to take and 13 s to give back. LSH operations have 33-92 keys,
about 1-2 s each on prod.

**Not tested:** two large operations colliding on dev. The deadlock it removes can't be staged on demand. The worker fix
(GD_ASYNC_WORKER v17, live) already keeps worker runs from holding keys across jobs.

## Tests
- `test_engine_precision.js`: 190 pass. `replay_engine_precision.js`: 16 pass, the real GUB run against prod v12.
- `test_one_stock_call.js`: 26 pass, and it fails on dev v16 (lanes) until patched.
- **Lint:** no new findings.
- **Scripts:** `scratchpad/gdc/gdcreate/patch_engine_precision.py`, then `patch_engine_one_call_both.py`.
- **Dev:** v16 = price only; v17 = both, live now.
