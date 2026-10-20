# Small Cycle IA — binding interfaces (scratchpad/iasc)

Spec: `Item Assembly & BOM/SmallCycle/CONTRACT_SOURCE.md` + the user's 2026-10-20 decisions (plan
`~/.claude/plans/cheeky-shimmying-puffin.md`, top section). Ledger: `.superpowers/sdd/cheeky-shimmying-puffin/progress.md`.
Everything here is binding between the work packages; a change is a ledgered ruling.

## 1. Names
| What | Value |
|---|---|
| Builder folder / outputs | `scratchpad/iasc/` / `Item Assembly & BOM/SmallCycle/` |
| Shared JS (pure, ES2015, no `?.` / `??`, one `module.exports` guard line) | `code/shared/sc_bom.js` (resolver), `code/shared/sc_proj.js` (projection); every name `sc` / `SC_`-prefixed |
| New workflows (user creates the shells after 10-21) | `SO_IA_PROJECTION` (read-only), `IA_SC_RELINK` (writes only the source columns) |
| New page | "SO Linked IAs" (opened from two SO `table_so` row actions) |
| Permission keys | `so_item_create_ia`, `so_item_linked_ias` |
| Client switch | `SC_ENABLED` (false = byte-identical legacy) |
| Limits | depth 6, paths 5,000, rows 1,000 (the posting fetch's distinct-item cap) |

## 2. Data (IA header + one line column; created by the IA form publish)
| Key | Stored as | Empty | Meaning |
|---|---|---|---|
| `source_so_id` | varchar digits | `''` | `sales_order.id` |
| `source_so_line_id` | varchar digits | `''` | exact `sales_order_axszx8cj_sub.id`; both ids empty or both digits |
| `source_so_context_json` | longtext JSON | `''` | context v1 (section 4) |
| `bom_consumption_mode` | varchar | `''` = legacy | `STANDARD` or `FLAT` |
| `source_bom_id` | varchar digits | `''` | the snapshot's root BOM id |
| `bom_snapshot_json` | longtext JSON | `''` | snapshot v1 (section 3) |
| `planned_output_qty` | decimal(65,8) | NULL | the plan, in `item_uom`; `item_qty` stays the actual that is posted |
| line `stock_movement[].sc_ref_key` | varchar | `''` = manual line | key of the snapshot row this line was built from |

**Enhanced** = `bom_consumption_mode` in (STANDARD, FLAT) AND `bom_snapshot_json` non-empty. The client creates a
snapshot only when an SO line is linked or Flat is chosen. Absent keys on a save keep the stored values (merge rule).

## 3. Snapshot v1 (`bom_snapshot_json`)
```
{ "v": 1, "mode": "STANDARD"|"FLAT", "itemId": "<FG id>", "uomId": "<IA item_uom>",
  "root": { "bomId": "<id>", "version": "<parent_mat_bom_version>", "baseQty": "<str>", "baseUomId": "<id|''>", "conv": "<str>" },
  "expand": ["<item id>", ...],                    // FLAT: the user's ticks, applied at every occurrence; STANDARD: []
  "boms": { "<bomId>": { "itemId": "<id>", "version": "<str>", "baseQty": "<str>", "baseUomId": "<id|''>" } },
  "rows": [ { "key": "<str>", "itemId": "<id>", "uomId": "<id>", "name": "<str>", "desc": "<str>", "remark": "<str>",
              "serial": 0|1, "nonStock": 0|1,
              "paths": [ { "boms": ["<bomId>", ...], "items": ["<itemId>", ...], "steps": [["<qty>", "<wastage%>", "<k>"], ...] } ] } ],
  "dropped": [ { "itemId": "<id>", "bomId": "<id>", "why": "REF" } ],
  "preparedAt": "<ISO>", "preparedBy": "<str>" }
```
- Numbers are strings (raw DB text or `String(number)`); ids are strings.
- Row keys: STANDARD `itemId|uomId|n` (n = 1-based occurrence of that item + UOM in the root BOM, duplicates stay
  separate rows as today); FLAT `itemId|uomId` (leaves aggregated by item + UOM, every path kept).
- **Recompute** for output Q (in `uomId`): `s = Q * root.conv / root.baseQty`; per path, per step i: `r = s * qty_i *
  (1 + w_i / 100)`; if a further step follows, `s = r * k_i` (k converts the component amount, in its row UOM, into
  batches of the child BOM: `toBase(item, rowUom) / toBase(item, childBaseUom) / childBaseQty`); the last step's `k` is
  `"1"`. Row reference = `q8(sum of the paths' last r)`, then `Math.ceil` when `serial`.
- `root.conv` = `toBase(FG, uomId) / toBase(FG, root.baseUomId)`, `"1"` when the base UOM is empty or equals `uomId`.
- `toBase(item, uom)` = 1 for `item.based_uom`, else `base_qty / alt_qty` of the item's conversion row whose
  `alt_uom_id = uom` (both > 0); otherwise unknown -> `SC_NO_CONVERSION` (never 1:1).

## 4. Context v1 (`source_so_context_json`)
```
{ "v": 1, "soId", "lineId", "soNo", "lineIndex", "customerId", "itemId", "orderedQty", "uomId", "headerStatus", "lineStatus",
  "linkedAt", "linkedBy", "history": [ { "op": "LINK"|"RELINK"|"UNLINK", "lineId", "orderedQty", "at", "by" } ] }
```
Baseline figures change only on LINK / RELINK (server rewrites them from its own read); history keeps the last 20.

## 5. Resolver `sc_bom.js`
- `scPickBom(boms)` -> the default (`parent_mat_is_default === 1`) else the highest `V<n>`, else the first; null if none.
- `scResolve(input, io)` -> Promise of `{ ok: true, snapshot, rows, tree }` or `{ ok: false, code, message, path }`.
  - `input`: `{ mode, itemId, itemUomId, outputQty, expand: [], fg (item row of the FG), preparedAt, preparedBy,
    maxDepth = 6, maxPaths = 5000, maxRows = 1000 }`.
  - `io.readBoms(itemIds)` -> rows of `bill_of_materials` (active, not deleted, the caller's organisation) whose
    `parent_material_code` is in `itemIds`, each with `subform_sub_material[]`; `io.readItems(ids)` -> item rows (`id,
    material_name, material_desc, based_uom, serial_number_management, stock_control, table_uom_conversion[]`). Both
    THROW on any failure; a missing requested item is a failure (`SC_READ_FAILED`).
  - Component rows used: `bom_material_code` set, `consume_type !== "REF"`, not `is_deleted`. REF rows go to `dropped`
    and are never expanded.
  - `rows` (form order): `{ key, item_selection, item_name, item_desc, requested_qty (number, q8 / ceil), quantity_uom,
    item_remark, nonStock, serial }`; name / desc / remark from the BOM row first, then the item (as today's explode).
  - `tree` (FLAT dialog, read once to depth 6): `[{ itemId, name, depth, parentItemId, expandable, reason, bomId, version }]`
    where `expandable` = the item has an active BOM with at least one usable row; `reason` is shown when it has not. The BOM
    is the one a `bom_type 'reference'` row names (`ref_bom_id`; the first such row of an item wins), else the default.
  - Expansion: an item in `expand` is replaced by its BOM at every occurrence (a `bom_type 'reference'` row's
    `ref_bom_id` picks that BOM among the item's own BOMs). Guards (nothing returned but the error): `SC_NO_BOM` (root),
    `SC_BOM_EMPTY` (root or a ticked item with no usable rows), `SC_EXPAND_NOT_ALLOWED` (ticked item without an active
    BOM), `SC_REF_BOM_MISSING`, `SC_BASE_ZERO`, `SC_NO_CONVERSION`, `SC_CYCLE`, `SC_TOO_DEEP`, `SC_TOO_MANY_PATHS`,
    `SC_TOO_MANY_ROWS`, `SC_READ_FAILED`. Each message names the item and its BOM path.
- `scRecompute(snapshot, outputQty)` -> `[{ key, itemId, uomId, qty }]` (pure; no reads).
- `scCheck(snapshot, header, lines, opts)` -> `{ ok: true }` or `{ ok: false, code, message }`:
  `SC_SNAPSHOT_INVALID` (not v1 / bad shape), `SC_SNAPSHOT_MISMATCH` (mode / item / UOM / root BOM differ from the
  header), and when `opts.completing`: `SC_REF_QTY_DRIFT` (a line whose `sc_ref_key` matches a row with the same item +
  UOM has `requested_qty` more than 0.0005 from `scRecompute(item_qty)`), `SC_EXPANDED_CONSUMED` (FLAT: a stock line of
  an expanded item). Lines without a matching key are manual lines (allowed, as today's variance).

## 6. Projection `sc_proj.js`
- `scProject(input)` -> `{ ok, code, message, eligibleNew, reason, uomId, totals, ias, warnings }`.
  - `input`: `{ line, header, fg, ias, excludeIaId, iaItemId, iaOrgId, proposal: { qty, uomId } | null, baseline (context v1)
    | null, candidates }` with `line` = `{ id, sales_order_id, item_name, so_quantity, so_item_uom, delivered_qty,
    line_status, is_deleted, line_index }` (null when not found), `header` = `{ id, so_no, so_status, organization_id,
    customer_id, customer_name, is_deleted }`, `fg` = the FG item row, `ias` = `[{ id, no, status, item_id, item_qty,
    item_uom, planned_output_qty, mode, is_deleted }]`.
  - Every figure in the line UOM: `qty * toBase(fg, iaUom) / toBase(fg, lineUom)`; an unconvertible IA ->
    `totals.complete = false`, `suggestion = null`, warning `UNCONVERTIBLE`.
  - IA status: Draft / Processing / Issued = open at `item_qty`; Completed / Fully Posted = produced at `item_qty`;
    deleted = nothing; anything else = nothing + warning `IA_STATUS_UNKNOWN`. `excludeIaId` removes only an open IA.
  - `ordered = so_quantity`, `delivered = delivered_qty`, `undelivered = max(ordered - delivered, 0)`
    (`outstanding_quantity` is never read); `planned` = sum of `planned_output_qty || item_qty`.
  - Active demand only when header Issued / Processing and line not Completed / Cancelled (and neither deleted).
    `suggestion = active ? max(0, ordered - max(delivered, produced) - openOthers) : 0`;
    `excess = active && proposal ? max(0, max(delivered, produced) + openOthers + proposalInLineUom - ordered) : 0`.
  - `eligibleNew` (a NEW link): line and header live, header org = `iaOrgId`, header Issued / Processing, line not
    Completed / Cancelled, `line.item_name === iaItemId`.
  - Warnings (`{ code, text }`): LINE_REMOVED (+ `candidates`), SO_REMOVED, SO_CANCELLED, SO_VOID, SO_CLOSED, SO_DRAFT, SO_INACTIVE (any other header status),
    LINE_CANCELLED, LINE_COMPLETED, ITEM_CHANGED, REDUCED (baseline ordered > current, same UOM), UOM_CHANGED, EXCESS,
    UNCONVERTIBLE, IA_STATUS_UNKNOWN.
- `scCandidates(input)` -> eligible live lines of an item with their suggestion (CANDIDATES operation).
- Quantities q8; a failed read never becomes 0 (the caller shows "figures unavailable").
- SUMMARY refuses (400, no figures) a line whose SO belongs to another organisation than the caller's `organization_id` (the
  line is read by id within the tenant). Warning texts name the line by its SO number ("SO/… line 1").

## 7. Workflows (built by `build_sc.py` into `Item Assembly & BOM/SmallCycle/`)
- `SO_IA_PROJECTION` (read-only). Request (all strings): `operation` SUMMARY | CANDIDATES, `so_id` (optional), `so_line_id`
  (SUMMARY), `item_id`, `exclude_ia_id`, `organization_id`, `proposal_qty`, `proposal_uom_id`, `baseline` (the IA's context JSON).
  Response: `code` ("200" / "400"), `message`, `result_json` = JSON text of `scProject(...)` + `orphans`, `line`, `header` (SUMMARY)
  or `{ candidates, capped }` (CANDIDATES). The SO of a line is read from the line itself (deleted too), else `so_id`.
- `IA_SC_RELINK`. Request: `ia_id`, `so_line_id`, `item_id`, `organization_id`. Only a Completed / Fully Posted IA whose linked
  line is gone, onto a live line of the SAME SO, item and organisation; refuses Processing ("being processed") and Draft ("edit
  the Item Assembly"). Writes ONLY `source_so_line_id` + `source_so_context_json` (baseline from the new line, history + RELINK,
  last 20), then reads back. Response as above ("200" / "400" / "500").
- SQL (`code/shared/sql.py`): varchar link columns are compared with QUOTED values; a `CAST(... AS CHAR)` compared with a column
  carries `COLLATE utf8mb4_general_ci` (dev raised "Illegal mix of collations" without it); `customer.customer_com_name` is the
  customer's display name.

## 8. Saves (`code/shared/sc_check.js`, patched into the DEPLOYED IA_SAVE v12 / IA_V2_SUBMIT v3)
- `scIn(input)` -> `{ need, edit, tenantId, iaId, lineId, present }`: `need` = "YES" for an Edit (page status Edit and a digit
  id; a Clone is an Add) or when any of the 7 keys is in the payload; `iaId` = "0" unless an Edit.
- `scClassicCheck(input)` -> `{ route: "OK" | "STOP", message }` + the 7 values to write. Merge: a key the payload leaves out
  keeps the stored value, a present `''` clears it; `planned_output_qty` = `toFixed(8)` of max(0, q8) or null. STOP when: half
  a link; an unknown mode; a NEW link (Add / Clone, or another line than the stored one) from an IA without an organisation,
  that `scProject` does not allow, or whose line is not on that SO; an item changed on the IA while it keeps its link (`stored.item_id` != the payload's; an item
  changed on the SO side is only the ITEM_CHANGED warning); FLAT without a snapshot; a failed `scCheck` (drift only when not
  Draft). The server owns `source_so_context_json` (the client's is a preview for the panel): a new link's is rebuilt from the
  server's read with the stored history + one LINK (RELINK over a stored link); an unchanged link and an unlinked IA keep the
  stored one; an unlink appends UNLINK to the stored one; a new IA has none until linked. No Small Cycle data = nothing checked.
- IA_SAVE v13: after `if_required_failed`, for Draft and Completed alike, before any write; refusal = `{ code: "400", message }`.
  IA_V2_SUBMIT v4: the source row is read with the other parallel reads on every submit; the check runs after the gate and
  BEFORE GENERATE_BATCH; refusal = STOP 400 `IA_SC_INVALID`. Either way nothing is written.

## 9. IA form client (`client/build_client_sc.py`, base = live dev form v36, md5 3fd73ecb...)
- Builds: **OFF** = v36 + the new widgets, every one hidden, no handler changed (the first publish creates the columns).
  **ON** = OFF + the handlers below with `SC_ENABLED = true`; with `false`, or a workflow id "0" (`scratchpad/iasc/ids.json`:
  `SO_IA_PROJECTION`, `IA_SC_RELINK`), every patched handler runs its v36 body only.
- Widgets. Data (dataBind): the 7 header keys of section 2 (`bom_consumption_mode` = radio STANDARD "Standard" / FLAT "Flat",
  no default; `planned_output_qty` = number p8, no default; the rest hidden inputs / textareas) + line `sc_ref_key` (hidden
  input). UI only (dataBind false; stripped from the V2 record by `IA_NOT_RECORD`): the section `sc_section` (a hidden one-column
  grid right after the header grid, shown on every editable page and on a read-only page of a Small Cycle IA; a grid because
  hiding a grid from code is proven in this app, a collapse is not) holding `sc_collapse` (one collapse panel "Sales Order
  Link", the SO form's Basic Info look) with `sc_info` (a hidden grid of read-only texts, each shown only when it has a fact;
  left: `sc_info_so` Sales Order (bold), `sc_info_customer` Customer, `sc_info_ordered` Ordered, `sc_info_delivered`
  Delivered; right: `sc_info_produced` Produced, `sc_info_open` In Progress, `sc_info_suggest` Suggested Qty with its sum
  (ordered − the larger of delivered / produced − in progress; bold; editable only), `sc_info_cover` After This IA (still
  needed / fully covered; editable only); full width: `sc_info_bom` BOM (mode · version · expanded count · prepared date, empty
  parts left out), `sc_info_over` over the order and `sc_info_warn` warnings (no label, the app's `error-msg` style, marked ⚠;
  unit ids shown as names; the server's EXCESS warning is not repeated)) and `sc_actions` (flex) with buttons `sc_btn_line` Select SO Line, `sc_btn_unlink` Unlink, `sc_btn_relink`
  Re-link, `sc_btn_suggest` Use Suggested Qty, `sc_btn_bom` Prepare BOM, `sc_btn_refresh` Refresh Figures; dialogs
  `sc_line_dialog` (table `sc_line_table`, a Select link per row) and `sc_expand_dialog` (button `sc_expand_all`, table
  `sc_expand_table` with an Expand tick per row).
- Routing (ON): an IA is **routed** when `source_so_line_id` is set, or the mode is FLAT, or it is enhanced (section 2).
  `onChange_assembledItem` and `onChange_itemQty` send a routed IA to the event `sc_main` (ops ITEM / QTY) before their v36
  body; `onChange_Plant` runs its v36 body, then op PLANT for an enhanced IA (lines rebuilt from the snapshot, no BOM read);
  `mounted` ends with op MOUNT; the four `confirmBomVariance` copies compare an enhanced IA with its snapshot at `item_qty`
  (reference vs actual, manual lines, removed rows, Flat expanded items = refused) plus the SUMMARY warnings (non-blocking;
  a failed call says "figures unavailable"). Everything else is the v36 code, unchanged.
- `sc_main` ops: ITEM, QTY, PLANT, MOUNT, MODE, PLANNED, SELECT_LINE, PICK_LINE, LINE_CLOSE, UNLINK, RELINK, SUGGEST, BOM,
  EXPAND_ALL, EXPAND_OK, EXPAND_CLOSE, REFRESH. Rules:
  - Preparation reads through fail-closed readers (a failed or partial read stops it); on any failure the previous item,
    mode, quantity, snapshot and lines stay as they were (SC26). Lines come from `scResolve` (+ `sc_ref_key`) and today's
    auto-allocation (the v36 code, copied verbatim).
  - LINK (a Select in the dialog): sets the two ids, mode STANDARD when empty, a client baseline (the server rewrites it); an
    IA with lines keeps them and their picks (keys stamped by item + UOM occurrence, `requested_qty` set to the reference);
    one without lines is prepared. `planned_output_qty` = the suggestion (IA UOM) when `item_qty` is empty or 0, else
    `item_qty`. UNLINK clears only the two ids (the context stays: the save appends UNLINK); a STANDARD IA then drops its
    snapshot, `source_bom_id`, `planned_output_qty` and line keys (legacy again), a FLAT one stays enhanced.
  - QTY on an enhanced IA: references recomputed from the snapshot (`requested_qty`), untouched lines (total = old reference)
    re-allocated or kept on the user's choice, edited lines kept and named; never a BOM read.
  - MODE FLAT: confirm when lines exist, Expand dialog (saved ticks pre-set), resolve, lines rebuilt. STANDARD on an unlinked
    IA = legacy (snapshot dropped, v36 explode); on a linked one = a Standard preparation.
  - ITEM on a linked IA: confirm "the link is removed" (Cancel puts the previous item back); then FLAT is prepared for the new
    item and STANDARD goes legacy (v36 explode).
  - MOUNT: Add / Clone / Edit of a Draft show the radio and Select SO Line; an enhanced or linked IA also shows the planned
    quantity, `sc_info` and its buttons; any other status shows `sc_info` read-only (Re-link only for a Completed / Fully
    Posted IA whose line is gone). SUMMARY excludes the IA only on Edit of a Draft. Opening never prepares or rewrites lines.
    Clone of an enhanced IA: link, context and plan dropped; FLAT keeps its ticks and is prepared again from the live BOM;
    STANDARD becomes a legacy clone.
- SO entry (WP5 page): `this.toView({ target: "2098256587713404929", type: "add", mode: "dialog", data: { item_id,
  source_so_id, source_so_line_id, bom_consumption_mode: "STANDARD" }, params: { sc_entry: "1" } })`. MOUNT then reads
  SUMMARY, sets the item fields, `planned_output_qty` = `item_qty` = the suggestion in the IA UOM, and prepares. A stale
  or ineligible line is reported: the link and the mode are cleared and the v36 item handler fills the item fields and today's
  lines (an ordinary IA for the item).
- Link (PICK_LINE) of an IA with a quantity but no lines: `planned_output_qty` = that quantity, then prepared at it.
- Preparation writes the header (snapshot, root BOM, item fields) and the lines in ONE setData; after allocation, an IA with
  serial components whose picks + serial lines exceed 250 (the classic cap: IA V2 refuses serial items) is told to split.
- Measured (899 dev 711077 BOMs, `test/bulk_sc_bom.js`): the snapshot is at most 239 KB in STANDARD (830 rows) and 513 KB in
  FLAT with every sub-assembly expanded. It travels with IA_SAVE (classic, <= 250 picks) and IA_V2_SUBMIT; PREPARE / COMMIT /
  WORKER / the V2 reverts never read it (no whole-row read of `sm_item_assembly`); the classic IA_REVERT's get-node does (<= 250 rows).
- The two dialog tables bind like the Transfer Stock dialog's, so the publish also creates two unused json columns
  (`sc_line_table`, `sc_expand_table`); nothing writes them.
- Platform points to verify on dev after 10-21 (the harness assumes them): P1 `triggerEvent` of `sc_main` by name with args from
  a handler (as `iaqty01x` does today); P2 a header `setData` may or may not fire the field's onChange (both are tested); P3
  the `text` display widget (the SO form's `delivery_method_text`, dataBind false) shows what `setData` writes and follows
  display / hide (one fact per row: no multi-line text needed); P4 `.filter(... in ...)` on `bill_of_materials` returns
  `subform_sub_material` inline (deleted rows are skipped by the resolver either way); P5 `toView` `data.item_id` shows the
  item's label in the picker, and whether that data fires item_id's onChange on open (if it does: the ITEM op sees no known
  previous item and does nothing); P6 a dialog table takes rows by `setData("<dialog>.<table>")` and its link column passes
  `{ row, rowIndex }`; P7 `getValues().<dialog>.<table>` returns the ticks of the switch column; P8 `getParamsVariables("sc_entry")`;
  P2b does a header setData fire its onChange in the same tick, and does that handler read back the `this.models._data` just
  written (the echo guards also fall back to the snapshot / the link's context, and a missed echo rebuilds nothing).
- Gates before publish batch 2 (after batch 1): `bom_snapshot_json` and `source_so_context_json` are longtext (a 64 KB TEXT
  column cannot hold a Standard snapshot above ~220 rows); a legacy Add / Draft / Complete through v13 stores
  `planned_output_qty` as NULL.
- Rollback = publish the OFF client AND restore IA_SAVE v12 + IA_V2_SUBMIT v3 from their pre-publish backups (v12 / v3 ignore
  the Small Cycle columns); the OFF client alone would leave enhanced Drafts that v13 / v4 refuse with no way to re-prepare them.

## 10. SO side (`so/build_so_sc.py`; base = live dev SO form v1240, md5 a716b1b8..., by a human developer + the GD sessions)
- SO form: `table_so` gains two custom row actions after View Info, nothing else changes (asserted): **Linked IAs**
  (permission `so_item_linked_ias`) and **Create IA** (`so_item_create_ia`), both `ignoreFormDisabled` (they work on a viewed
  SO). Hidden: any line without an id or an item (unsaved); Create IA also on a Completed / Cancelled line or a header other
  than Issued / Processing. Each opens the page `SO_LINKED_IAS_PAGE` (ids.json) in a dialog with params `so_id`, `so_line_id`,
  `item_id`, `organization_id`, `sc_action` ("" / "create"); page id "0" = a message, nothing opens.
- Page "SO Linked IAs": `sli_summary` (a grid of read-only texts, each shown only when it has a fact, as the IA form's section:
  left Sales Order (bold), Customer, Item, Ordered, Delivered; right Planned, Produced, In Progress, Suggested Qty with its sum
  (bold); full width the warnings (no label, `error-msg`, marked ⚠)), `sli_ias` (the line's IAs: number, status, mode, planned,
  actual, UOM, counted as, Open), `sli_orphans` (the SO's IAs whose line was removed, shown only when there are some), buttons
  Create Item Assembly (shown only on an eligible line) / Refresh / Close. `mounted` and the `refresh` lifecycle run `sli_load`
  (SUMMARY, no exclusion, no proposal); a failed read says "unavailable" and shows no figure. Create (the button, or
  `sc_action` "create" on open, once) re-reads SUMMARY and opens the IA form only when `eligibleNew`:
  `toView({ target: "2098256587713404929", type: "add", mode: "dialog", data: { item_id, source_so_id, source_so_line_id,
  bom_consumption_mode: "STANDARD" }, params: { sc_entry: "1" } })` (section 9's SO entry). Open: a Draft to edit, any other
  status to view. The plant is not prefilled: the IA form's own plant rules apply.
- Outputs: previews in `so/out/`; `--write-repo` (refused while an id is "0") writes `SOform.json`, `SOLinkedIAsPage.json` and
  the mirrors to `Item Assembly & BOM/SmallCycle/`. Before the upload the SO base is re-pulled: any dev change -> rebuild.
- Platform points (after 10-21): P9 a row action's `{{ }}` hidden may call `this.getValue`; P10 `arguments[0].row.id` is the
  saved line's id; P11 a page opened from a form opens a form dialog (three levels: SO -> page -> IA); P12 the IA form's
  `parentGenerateForm.refresh()` runs the page's `refresh` event (if not, the user presses Refresh) and does NOT re-run its
  `mounted` (if it does, `sc_action` "create" re-opens the IA form after every save: drop the open-on-mount then).
