# Transfer requests from a reserved Item Assembly, with defect handling: design

For approval before any build. 29 October 2026.

- **What it changes.** The IA → Location Transfer Request (ENH-20261027-001), built on dev on 28–29 October (B1–B21). Nothing of
  it is on prod yet, so the logic can change before it ships, with no data to migrate.
- **Who decided.** The decisions are the user's (29 October); they are listed in section 12.
- **Marking.** Everything marked *(my call)* is the designer's choice and open to change.

## 1. What changes, and why

**Today (dev):**
- A Draft IA requests its materials, and nothing is reserved.
- The warehouse chooses the stock with Save Picks.
- Dispatch moves free stock into transit.
- Receive lands it at the staging bin as free stock. The IA then picks it from there (B21) and is saved as Created or Completed.

**Three problems:**
1. While a request waits, other documents can take the materials, so the stock is not guaranteed at dispatch.
2. There is no way to report defective material at receipt and replace it.
3. After Receive, the stock is free at the staging bin until the IA is saved again.

**New:**
- The IA is saved as Created first, so RES-01 reserves its components.
- The request moves that reservation.
- Receive keeps the stock reserved at the staging bin and records defects.
- A replacement request covers whatever is missing.

**This reverses the original spec**, IA-LT-04: "Requested makes no stock movement or reservation". The user confirmed the change
on 29 October (D8).

## 2. The flow

1. **Production saves the IA as Created.** Its components are reserved at the warehouse bins its auto-allocation chose (RES-01,
   as today). An IA that is only partly reserved can still make a request (D1).
2. **Request Materials** (Created IAs only).
   - One request line per reserved stock line, for the reserved quantity.
   - Each line's picks start as the IA's reserved bins and batches.
3. **The warehouse opens the request.**
   - It can change any pick to another bin or batch of the item, wherever the stock really is (D9).
   - The pick dialog counts this IA's own reserved stock as available, so the reserved bins stay selectable.
   - Save Picks moves no stock.
4. **Dispatch** is one locked step. It releases the IA's reservation for these lines and moves the picked stock into transit, so
   the stock is never free in between.
5. **Receive.** Production enters Good and Defect per line, or per batch for a batch-managed item, so the right batch is the one
   blocked *(my call)*.
   - Good + Defect must equal what was dispatched; anything lost counts as defect (D5).
   - Defect needs a reason (D7).
   - Good goes straight into Reserved for the IA at the staging bin, and the IA's picks move there too (D10).
   - Defect goes to Blocked at the staging bin.
6. **Replacement.**
   - It is offered right after Receive when anything was defective; a separate button stays for later (D6).
   - It reserves the missing quantity from the warehouse for the IA, then makes a replacement request from that reservation.
     Steps 3–5 then repeat.
   - **How the missing quantity is reserved** *(my call)*: the IA form re-runs its own allocation for just the missing quantity
     (default bin first, then oldest, as today). It may use anywhere in the plant except the staging bin, and it leaves the IA's
     staging picks alone. The form then saves the IA as Created, RES-01 reserves the new picks, and the request is made from them.
     The allocation runs only in the browser, which is why the form does this.
   - **Where the offer appears.** The offer appears on the IA form once the Location Transfer form closes after Receive. A
     Receive done from the Location Transfer list shows the offer the next time the IA is opened.
   - The same button covers the unreserved rest of a partly reserved IA (D1).
7. **Report defect** (D2), for damage found after Receive, during production.
   - Production enters a defect quantity and reason per line, or per batch for a batch-managed item.
   - That reserved stock moves to Blocked at the staging bin, and the IA's reservation and picks drop by the same amount.
   - A replacement is then offered.
8. **The IA completes** from its reservation at the staging bin, once none of its requests is open. Every line a request can
   carry must be there by then (D11).

## 3. Rules

**Before dispatch:**
- Cancel only changes the request's status. The IA keeps its reservation.
- If the IA's reservation changes, the request refreshes from it, and the picks reset to the reservation (D4).

**After dispatch:**
- Changes to the IA are refused until the request is received (D4).
- Cancel is allowed. The stock goes back to the bins it was picked from, reserved for the IA again (D3).

**The setup switch (D12, D13):**
- A new **Item Assembly Setup** decides whether the feature is available. It is a new table, built like Picking Setup:
  - one setting per organisation;
  - its save writes the same values to every plant row of the organisation;
  - readers take the organisation's row.
- The switch is **Transfer Request**. It is off by default, and no row means off *(my call)*.
- **When it is off:**
  - the IA form shows no request section (no Request Materials, replacement or Report defect);
  - IA_TRANSFER_REQUEST refuses a first request;
  - an IA works exactly as it does today.
- **Turning it off while requests are in progress:** those IAs finish normally (D13). An IA that already has a request keeps
  dispatch, Receive, replacement, Report defect and cancel until it completes, so nothing is stranded.
- The setup has room for later Item Assembly settings, for example the finished-goods reservation switch if that work resumes
  *(my call)*.

**Always:**
- One open request per IA at a time. A replacement is made only after the previous request is received *(my call)*.
- Full fulfilment at dispatch, as today: each line's picks equal its requested quantity.
- Only Created IAs can request, because a Draft reserves nothing.
- **Once an IA has used a request, every stock line a request can carry must be consumed from the staging bin** (D11).
  - A line that was never reserved, for example out of stock that day, must arrive by replacement before the IA completes.
  - Serial-numbered items and stock in a handling unit can't travel by request, so they are picked from the warehouse as today.
- Every stock move of a request runs through LOT V2 only, as today.
- **Permissions:** the same three keys as today.
  - `ia_create_transfer_request`: request, replacement, refresh, and cancel before dispatch.
  - `lot_ia_dispatch`: dispatch.
  - `lot_ia_receive`: Receive, and Report defect *(my call)*.

## 4. Data

- **Item Assembly Setup (new table `item_assembly_setup`).**
  - Columns: `organization_id`, `plant_id`, `transfer_request_enabled` (0 / 1), plus the platform's standard columns.
  - One row per plant of the organisation, all with the same values, as Picking Setup keeps them. An organisation with no
    plants has one row whose `plant_id` = the organisation.
- **Location Transfer lines:** new `defect_qty` (the line's total), `defect_reason`, and `defect_detail` (per batch, as JSON text,
  for batch-managed items). The reason comes from `category_transfer_reason`, the Category Transfer reason list *(my call:
  names)*.
- **Location Transfer header:** new `replacement_for_id`, the received request a replacement follows. It is shown as
  "Replacement for LOT-…" *(my call)*. The existing `replaces_id` keeps its meaning: the cancelled request it replaces.
- **RES-01 reservation rows** (`on_reserved_gd`, doc_type "Item Assembly"):
  - Dispatch marks the released rows Cancelled, with the request as their marker.
  - Receive and the cancel reversal insert new rows (Allocated, `from_category` Unrestricted): at the staging bin for Receive, at
    the picked bins for the cancel reversal.
  - Report defect reduces them.
  - These rows look like IA_HOLD's own, so its other operations treat them normally *(my call: marker in `job_line_key`)*.
- **IA lines.** Receive, Report defect and the cancel reversal rewrite the lines' picks (`temp_qty_data`) from the transfer side.
  This is safe because changes to the IA are refused while a request is in transit (D4).
- **IA header.** The reservation status also shows "In transit (LOT-…)" while a request is dispatched *(my call)*.
- **Stock movements:**
  - Receive's good part is the request's own movement, into Reserved at the staging bin.
  - Its defect part goes into Blocked.
  - Report defect is a category move, Reserved → Blocked, under the IA number, transaction type **IA-D** *(my call)*.
  - The request records any pick made away from a reserved bin ("reserved at A1, picked from A2"), so the warehouse knows which
    bins to count *(my call)*.

## 5. What changes in each part

| Part | Change |
|---|---|
| Item Assembly Setup (new form and table) | The Transfer Request switch. Its mount and save handlers copy Picking Setup's (`Picking/PickingSetupOnMounted.js`, `Picking/PickingSetupSave.js`): the save writes every plant row of the organisation. |
| IA_TRANSFER_REQUEST (Workflow 5) | Reads the setup: a first request is refused when the switch is off, but every action on an IA that already has a request still works (D13). CREATE from a Created IA: lines and starting picks from its reservation, partial allowed. REFRESH from the reservation. REPLACE: a replacement request from the IA's new reservation, after a receipt. DEFECT: Report defect, i.e. the engine move Reserved → Blocked at the staging bin, plus the rows and the IA's picks. The claim numbering counts all of the IA's requests. |
| LOT V2 SUBMIT / PREPARE / COMMIT | **Dispatch:** release the IA's reservation and stage the picks in one engine operation, with the released rows Cancelled and marked. **Receive:** good → Reserved at the staging bin, plus new IA rows and the IA's picks; defect → Blocked, with its quantity and reason on the line. **Cancel after dispatch:** back to the picked bins, reserved for the IA. **The dispatch check:** accepts Created IAs, partial requests and replacement requests. |
| Classic SM_LOCATION_TRANSFER | No change. Save Picks stays stock-neutral, and its guard is unchanged. |
| LOT form / list | The pick dialog adds the IA's own reservation back. Receive dialog with Good / Defect / reason per line. "Replacement for LOT-…". The replacement offer after Receive. |
| IA_HOLD (RES-01) | Leaves an IA alone while its request is dispatched, so it doesn't reserve again at the old bins. Accepts the rows written by the transfer side. |
| IA_SAVE and IA_V2_SUBMIT | The request check reads all of the IA's requests (today only the latest). Once an IA has a request, every stock line a request can carry must be picked at the staging bin (D11); today only the lines a request delivered are checked. Serial-numbered and handling-unit lines are exempt. Created is allowed before a request. Any save is refused while a request is in transit, and completion is refused while any request is open. |
| IA form | Reads the setup on open: with the switch off and no request on the IA, the request section stays hidden. Request Materials only on Created. The list of the IA's requests. The replacement offer and button. Report defect. B21's automatic staging pick is retired, because Receive moves the picks. |
| IA list | The Transfer Request column shows the latest open or received request. |

## 6. Technical points to prove before building

1. **IA_HOLD while stock is in transit.** It must leave the IA alone at that stage. Otherwise it sees picks with no reservation
   behind them and reserves again at the old bins.
2. **The dispatch swap.**
   - One engine operation must release a reservation and pick from the same bin. IA_HOLD already releases and reserves in one
     operation; the same-bin case is still to be confirmed.
   - The dispatch check and the engine plan must treat a pick at the IA's own reservation as released, then picked.
3. **Receive's target category.** Today Receive puts stock back in the category it travelled in. For these requests, Receive
   must put good stock into Reserved and defect into Blocked.
4. **The IA save check** must read all of the IA's requests, not only the latest.
5. **Writes from the transfer side.** Receive writes the IA's picks and reservation rows, which is safe only because changes to
   the IA are refused after dispatch (D4).

## 7. Not in scope

- **Stock Picking for these requests**: worker confirmation, and moving the reservation's source. This is future work, as the
  user noted on 29 October.
- **The finished-goods reservation** (`Item Assembly & BOM/SmallCycle/FG_RESERVATION_DESIGN.md`), on hold.
- **The defective stock afterwards.** It stays Blocked at the staging bin until it is returned or written off with existing
  documents.
- **Mobile.** Requests stay web-only: the app can view them, but not dispatch or receive them.

## 8. What LOWCODE cannot guarantee

1. **Classic writers take no engine lock** (MIN-01).
   - Reserved stock is safe from pickers, because they read Unrestricted.
   - But Disposal/Scrap and Goods Issue can consume Reserved stock without an owner check (the RES-01 note).
   - The warehouse's picks at other bins are not protected until dispatch. If another document takes them meanwhile, dispatch
     refuses cleanly (all or nothing) and the warehouse picks again.
2. **Wrong stock records at a bin.** The swap frees the reserved bin's stock, which may not really be there. The request records
   the bins to count (section 4).
3. **Stock missing everywhere.** It can't be dispatched in full. The way out uses steps the design already has *(my call)*:
   1. Production lowers the IA's picks by what's missing and saves, so RES-01 releases that part of the reservation.
   2. The request refreshes to the smaller reservation (D4) and is dispatched in full.
   3. The warehouse counts the bin. A Stock Count can adjust it now, because it is no longer Reserved; Stock Adjustment filters
      Reserved stock out.
   4. The missing part comes later by replacement (D1).

   There is no short dispatch, because that would break full fulfilment. The cost: the warehouse depends on production to lower
   the IA.

## 9. Size

| Part | Size |
|---|---|
| IA_TRANSFER_REQUEST: CREATE / REFRESH / REPLACE / DEFECT | 4–5 h |
| LOT V2: dispatch swap, Receive good/defect into Reserved / Blocked, cancel back into the reservation, dispatch check | 6–8 h |
| LOT form / list: pick add-back, Receive dialog, replacement offer, label | 2–3 h |
| IA_HOLD: in-transit rule, rows from the transfer side | 1.5–2 h |
| IA_SAVE and IA_V2_SUBMIT: the request check | 1.5–2 h |
| IA form: request list, replacement, Report defect, retiring B21 | 2–3 h |
| Item Assembly Setup: form, save, and the readers in the IA form and IA_TRANSFER_REQUEST | 1.5–2 h |
| Tests and live tests on dev | 4–5 h |
| **Total** | **about 25–32 h** |

## 10. Live tests on dev

Standing rules apply:
- Tell bladexfunctions-3f before using 711077's stock.
- Never touch the "blade, loose" item at its bin, SO/20261016-034 or SO/20261016-035.
- Keep RES-01 tests off item 2783-000000-00.

| # | Test | Expected |
|---|---|---|
| T1 | Created IA, fully reserved: request, then dispatch from the reserved bins | Reservation released and stock in transit in one step, never free; rows Cancelled and marked |
| T2 | The warehouse picks another bin or batch | The reserved bin's stock becomes free, the picked stock goes into transit, and the bin to count is recorded |
| T3 | Receive with no defect | Reserved for the IA at the staging bin; the IA's picks are there; the IA completes from them |
| T4 | Receive with a defect | Defect Blocked at the staging bin, with its reason; the replacement is offered; declined, the button stays |
| T5 | Replacement | The missing quantity is reserved from the warehouse, the replacement request is made, then dispatch and Receive as in T1–T3 |
| T6 | A partly reserved IA | Request for what's reserved; the rest comes by replacement once received |
| T7 | Report defect after Receive | Blocked; the reservation and picks drop by the defect; the replacement is offered |
| T8 | Cancel before dispatch; cancel after dispatch | Before: status only, the IA keeps its reservation. After: back to the picked bins, reserved for the IA. |
| T9 | Changing the IA before dispatch; after dispatch | Before: the request refreshes. After: refused until received. |
| T10 | The IA's completion: while a request is open; with a never-reserved line picked from a warehouse bin; with a serial line picked from a warehouse bin | Refused; refused; allowed (D11) |
| T11 | IA_HOLD's reservation check and the list sweep while the stock is in transit | Nothing reserved again at the old bins |
| T12 | Regression: an IA with no request, and ordinary Location Transfers | Unchanged |
| T13 | Reserved stock missing at every bin: lower the IA, refresh, dispatch, count, replace | The request is dispatched in full for what was found; the rest arrives by replacement |
| T14 | A batch-managed line with a defect in one of two batches | Only that batch is Blocked; the IA's reservation and picks keep the other batch |
| T15 | The setup off, or no setup row | No request section on the IA; a first request is refused; the IA saves and completes as today |
| T16 | The setup turned off while an IA's request is in transit | Dispatch, Receive, replacement, Report defect and cancel still work for that IA until it completes (D13) |

## 11. Rollout

**Dev:**
0. The user creates the Item Assembly Setup form (table `item_assembly_setup`) and its menu entry in the designer. We then
   publish its fields and handlers.
1. Finish or cancel dev's existing test requests from Draft IAs.
2. The LOT form fields: `defect_qty`, `defect_reason`, `replacement_for_id`.
3. IA_HOLD.
4. LOT V2: PREPARE, COMMIT and WORKER before SUBMIT.
5. IA_TRANSFER_REQUEST.
6. IA_SAVE and IA_V2_SUBMIT.
7. The forms ON.
8. The live tests.

**Prod:** the user creates the same Item Assembly Setup form and menu entry first. Then the whole transfer request feature ships
as one paste after dev passes. The prod folder
`prod-hotfix/2026-10-28-ia-transfer-request/` is rebuilt for it, because the current one is out of date. Nothing is pasted
between 10 pm and 1 am.

## 12. Decisions (all answered by the user, 29 October)

| # | Decision | Answer |
|---|---|---|
| D1 | An IA that is only partly reserved | It can request what's reserved; the rest is replaced later |
| D2 | Defects found after Receive | Report defect on the IA |
| D3 | Cancelling a dispatched request | Allowed; the stock goes back to the bins it was picked from, reserved for the IA |
| D4 | Changing the IA while its request is open | Before dispatch, the request refreshes. After dispatch, refused until received. |
| D5 | Receive must account for every unit | Good + Defect = dispatched; lost counts as defect |
| D6 | The replacement | Offered right after Receive, plus a separate button for later |
| D7 | A defect reason | Required, from the Category Transfer reason list |
| D8 | Reversing IA-LT-04 (requests now reserve through the IA) | Confirmed by the user |
| D9 | Which stock the warehouse may pick | Any bin or batch of the item |
| D10 | Received stock | Reserved for the IA straight away at the staging bin; never free |
| D11 | A line that was never in a request (for example out of stock that day) | It must arrive by replacement before the IA completes. Serial-numbered and handling-unit stock are picked from the warehouse as today. |
| D12 | Switching the feature on and off | A new Item Assembly Setup, built like Picking Setup (a new table), with a Transfer Request switch |
| D13 | Turning the switch off while requests are in progress | Those IAs finish normally; off stops new requests only |
