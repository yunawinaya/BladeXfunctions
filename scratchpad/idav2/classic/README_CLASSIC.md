# IDA_SAVE v7 - the guarded classic save (package B)

`Item Disassembly/AsyncV2/IDA_SAVE.json` = live dev **v6** (`base/IDA_SAVE.v6.json`, md5 `e79c2d2e7de55f8e232612d9e9ef6c4b`,
workflow `2107305535347552257`) + exactly **two** changes (CONTRACT.md section 11, user decision 3). It ships with the promotion
whatever the V2 switches say. Every other v6 node is byte-identical (`classic/diff_v6.py`).

## Change 1: the IDA V2 guard, the first nodes after `start`

`code_node_IDAguardIn` -> `if_IDAguardRead` [`sql_node_IDAguard` -> `code_node_IDAguardStored` -> `if_IDAguard400` / `if_IDAguard409`]
-> `if_IDAguardBig`. The returns are copies of v6's `return_required_400` / `return_idem_409` (status 200, `{ code, message }`).
400 or 409, never 401.

| When | Answer |
|---|---|
| Edit with a digit `allData.id` (and a digit session tenant), stored `Processing` (any saveAs) | 400 "This Item Disassembly is being processed in the background - please wait for it to finish." |
| Edit, stored `Completed` / `Fully Posted`, saveAs `Draft` (the stale-tab bug: v6 wrote the IDA back to Draft) | 409 "This Item Disassembly is already <status> and cannot be saved again." (= v6 `code_idem_guard`'s text) |
| any page, saveAs not `Draft`, more than 250 moves (source picks with `sm_quantity > 0` + recovery lines with an item) | 400 "This Item Disassembly has <n> source picks and recovery lines - too big for the classic save, which handles at most 250 at once. Complete it from the web form with background completion switched on, or split it into smaller disassemblies." |

Only an Edit reads the stored status (one SQL, `CLASSIC_GUARD`: `sm_item_disassembly` only, tenant-scoped); an Add, a Clone / Copy
(it may carry the source id) and a Draft save of a big IDA read nothing. The guard reads no V2 table and no stored pick count. Its
code is `code/shared/ida_common.js` (the moves count and texts SUBMIT and the client share) + `classic/guard_in.js` /
`guard_stored.js`.

## Change 2: `code_cost_alloc` prices per BASE unit

`unit_price: qty > 0 ? q8(lineValue / qty) : 0` becomes `unit_price: baseQty > 0 ? q8(lineValue / baseQty) : 0`, with `baseQty` =
ADD_INVENTORY v65's own conversion of the line (`code_node_mvszWJ8p`): `alt = line.quantity_uom || item.based_uom` on the item's
`search_items` row, the first `table_uom_conversion` row whose `alt_uom_id` equals `alt` (as text), `baseQty = q8(qty x base_qty)`, else
`qty`. ADD books `total_price = q8(unit_price x baseQty)` = the line value up to q8; v6 booked `factor x` the line value on a non-base-UOM
line. A base-UOM line is priced exactly as before. The quantity share, the last-line remainder, `issuedValue` (its trx_no read), the
receipt fields and the HU / Item-stamp nodes are unchanged.

Verified on dev: `search_items` rows carry `table_uom_conversion` with `alt_uom_id` / `base_qty`, and at run time `code_cost_alloc`
sees the ids as exact 19-digit text (its recorded output, run 2110985743831793666), as ADD's child requests show - so the text compare
equals ADD's `===`.

## Not changed (deliberately)

The GENERATE_BATCH loop and its Redis array, the blank Batch row per non-batch line, `code_idem_guard`, the 401 / 402 answers, the
header written Completed before stock moves.

## Build, prove, test

```
python3 scratchpad/idav2/build_classic.py --write                # or build_ida.py IDA_SAVE
python3 scratchpad/idav2/classic/diff_v6.py                      # node-by-node proof: PROBLEMS 0
python3 scratchpad/idav2/lib/lift/lift.py scratchpad/idav2/classic/lift_v7.json   (lift_v6.json, lift_add.json once)
node scratchpad/idav2/classic/test_v7.js                         # v7 bodies vs v6 on the recorded dev runs, the price fix through ADD's own bodies, the guard bodies
node scratchpad/idav2/classic/test_guard_sim.js                  # v7 and v6 side by side on the FlowGram interpreter
python3 scratchpad/idav2/classic/mutants_v7.py                   # every mutant of the two changes is caught
python3 scratchpad/validate.py "Item Disassembly/AsyncV2/IDA_SAVE.json"
```

Before the publish: `python3 scratchpad/idav2/base/snapshot.py --check` (live dev must still be v6, else rebuild on the new base), a
`base` guard in the wf_upload plan, and the classic regression of the plan's verification 1-2.
