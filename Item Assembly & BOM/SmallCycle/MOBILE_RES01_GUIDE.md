# Mobile Implementation Guide — Item Assembly raw-material reservation (RES-01)

What the mobile app must add so an Item Assembly (IA) edited on mobile reserves, uses and gives back its component stock the
way the desktop form does.

This guide is a **delta** on the existing mobile IA integration. It assumes the app already saves IAs with
`runWorkflow("2098335576774463489" /* IA_SAVE */, { allData, saveAs, pageStatus })`, has a stock picker for component lines,
and deletes Draft IAs from its list.

> Status (22 October 2026): the reservation starts at the **Created** status (the BA's request, 22 October), no longer at a
> Draft save: a Draft never reserves. The switch is **ON** on DEV and ships ON with tonight's promotion. Mobile has no Created
> button yet, so mobile Drafts never reserve; sections 2, 5 and 7 say what mobile must do for a Created IA. The switch only decides whether new holds are made; an IA that already holds stock (a stored `material_hold_status`)
> is completed, closed, released and reverted from its holds whatever the switch says, so sections 3 to 5 apply to it always. Even then mobile keeps working without these changes (section 7 says what it costs); the changes make it match
> desktop. Live on DEV since 17:07 on 22 October (IA_HOLD v11, IA_SAVE v24, IA_V2_SUBMIT v12, IA form v54); the additions of that
> day are in sections 2, 5, 6 and 8. Design: `RES01_DESIGN.md` (this folder). Desktop reference handlers: `iaForm_onClick_saveAsCreated.js`, `iaForm_onClick_saveAsDraft.js`,
> `iaForm_onClick_saveAsCompleted*.js`, `iaForm_onClick_select_stock.js`, `sc_main.js` (RES-01 block),
> `../AsyncV2/iaList_delete.js`.

---

## 1. Mental model

- A **hold** is component stock of a **Created** IA moved from its category (Unrestricted, or Blocked) into **Reserved**, plus one
  `on_reserved_gd` row: `doc_type = "Item Assembly"`, `doc_id` = the IA id, `doc_line_id` = the component line id,
  `material_id`, `bin_location`, `batch_id`, `from_category`, `open_qty` in `item_uom`, `status = "Allocated"`.
- Holds belong to the IA. Other documents cannot take them; **this** IA may use them (section 4).
- Only the workflow **IA_HOLD** (`2112752274794217473`) creates, changes or ends holds. IA_SAVE never calls it: the client
  does, after IA_SAVE answered.
- The header field `material_hold_status` says where the IA stands:

| Value | Meaning |
|---|---|
| `""` | not enrolled: the IA never reserves (every Draft, every IA created before the switch, and IAs completed at once) |
| `RESERVING` | saved as Created, reservation not made yet (IA_SAVE sets it) |
| `FULL` / `PARTIAL` / `SHORT` / `NONE` | the last reservation's result (all / some / none of the required stock held / nothing to hold) |
| `REVIEW` | the last reservation did not finish: save again to retry |
| `CLOSED` | completed: what was used is delivered, the rest released |

## 2. Created: the save that reserves

**A Created save goes through the Draft path.** Send `saveAs: "Draft"` with `allData.ia_target_status = "Created"`:

```js
runWorkflow("2098335576774463489" /* IA_SAVE */, { allData: Object.assign({}, allData, { ia_target_status: "Created" }), saveAs: "Draft", pageStatus });
```

**Never send `saveAs: "Created"`**: IA_SAVE treats any saveAs other than "Draft" as a completion and would issue the stock.
IA_SAVE writes `item_assembly_status = "Created"` and marks the IA `RESERVING`. A Draft save (no flag) is written Draft and never
reserves. A Created IA saved again (with or without the flag, on an Edit) stays Created: it never goes back to Draft.

When IA_SAVE answers `code` `"200"` for a Created save, **or** for any save of an IA whose `material_hold_status` is not empty, call:

```js
runWorkflow("2112752274794217473", {
  ia_id: savedId,                 // IA_SAVE's answer `id` (or the IA's id on an edit)
  organization_id: orgId,         // the IA's organization_id, as text
  operation: "RECONCILE",
  source: "SAVE",
});
```

- On a Created IA it reserves what the saved lines need and releases the surplus; on a Draft that still holds something (an IA
  reverted, or saved before Created existed) it gives everything back. A plain Draft: no call.
- Up to 50 picks with a quantity: wait for it and show its `message`. Above 50: start it and do not wait (it can take a while).
- Answer: `code` `"200"` with `message` and `result_json` (a JSON string: `{ status, lines, notHeld, short, held, released,
  checkedAt, message }`). An empty `result_json` means there was nothing to reserve (the server did not enrol the IA): show
  nothing.
- `code` `"409"`: another reservation of this IA is running. Do not retry in a loop: the IA is reconciled again when it is next
  opened on desktop, or saved again.
- The reservation can be switched off on the server (IA_HOLD's own switch, ON today). Off, RECONCILE makes no new hold from any caller
  and its `message` ends with "Reservation is switched off: no new stock is reserved (...)"; releasing, closing and cancelling work as
  usual. Show the message as it is.
- Keep ids as **strings**. Never `Number()` an id: 19-digit ids lose their last digits.
- Show the status `Created` with the shared status dictionary's label; a Created IA is edited like a Draft (no Draft button).

## 3. After a completion: close the holds

When IA_SAVE answers `code` `"200"` for `saveAs: "Completed"` (or Complete & Post), and the IA was a stored IA (`pageStatus`
Edit) whose `material_hold_status` was **not empty**, start (do not wait):

```js
runWorkflow("2112752274794217473", { ia_id, organization_id, operation: "CLOSE", source: "COMPLETE" });
```

A new IA completed at once never held anything: no call. The server already issued the held parts from Reserved during the
completion; CLOSE marks the used rows Delivered and gives the unused rest back to its category.

If the mobile app later adopts the background completion (IA V2, more than 50 picks), call CLOSE once the job is `COMPLETED`.

## 4. The IA's own picker: add its holds back

The picker reads free stock (`unrestricted_qty`, or `block_qty` for Blocked). Stock this IA holds was moved to Reserved, so
without a change the IA cannot pick its own reserved stock. For an IA with a non-empty `material_hold_status`:

1. Read its own rows once when the picker opens:
   `on_reserved_gd` where `doc_type = "Item Assembly"`, `doc_id = <this IA id>`, `status = "Allocated"`, `is_deleted = 0`.
2. Skip rows with a `handling_unit_id` (handling-unit picks are never held).
3. For each balance row shown (material + bin + batch + category), add the sum of the matching rows'
   `open_qty × factor`, matched on `material_id`, `bin_location`, `batch_id` and `from_category` (empty = `Unrestricted`).
   `factor` = 1 when `item_uom` is the item's `based_uom`, else the item's `table_uom_conversion` row with
   `alt_uom_id = item_uom` → its `base_qty`.
4. Never add another document's holds (another IA, a Goods Delivery).

The user picks this stock as **Unrestricted** (or Blocked) as usual. At completion the server splits each pick: the held part
is issued from Reserved, the rest from the pick's category.

## 5. Cancel and delete (22 October)

**Cancel** (desktop): a Created IA is cancelled from the Item Assembly list (bulk Cancel; the form has no Cancel button since 22 October evening): IA_HOLD `operation: "CANCEL"` releases everything it
holds and only then sets `item_assembly_status = "Cancelled"`; a release that cannot finish leaves it Created (Needs review). A
Cancelled IA is read-only: IA_SAVE refuses any save of it (`409`, "This Item Assembly is cancelled: it can no longer be changed.").
Mobile: show Cancelled read-only (no save / complete).

Mobile matches desktop (user 22 October evening): **no Cancel on the IA's own view**; Cancel is a bulk action on the IA list (selected
Created IAs, one at a time, as `../AsyncV2/IAlistPage.json`'s `onItemAssemblyCancel`), with source `"LIST"`. Show it only to users with
the **`ia_cancel`** permission (the desktop list button's own key since 22 October 20:22, the product owner's change; not `ia_save_draft`).
Each call, after one confirm:

```js
const res = await runWorkflow("2112752274794217473", { ia_id, organization_id, operation: "CANCEL", source: "LIST" });
// cancelled only when res.data.code === "200" and JSON.parse(res.data.result_json).cancelled === true; anything else: show
// res.data.message, the IA stays Created ("Already cancelled." = 200 with no result_json: reload)
```

**Refuse a delete** of `Created` ("Item Assembly <no> is Created: cancel it first (Cancel releases its reserved materials).") and of
`Completed`, `Fully Posted` and `Processing` ("Item Assembly <no> is <status> and cannot be deleted."), from the **stored** status read
right before the delete (the list on screen can be stale: a background completion may hold the IA now).

**Delete** is for **Draft and Cancelled** IAs only. A Created IA cannot be deleted: refuse with "cancel it first" (cancel it on
desktop). Deleting a Draft or Cancelled IA whose `material_hold_status` is not empty releases first, as the desktop list does:


The desktop list does it in this order (22 October): re-read the stored `material_hold_status` (the list can be stale); if it is
not empty, **delete the header first** (`is_deleted = 1`, so no new reservation can start for it), then call:

```js
const res = await runWorkflow("2112752274794217473", { ia_id, organization_id, operation: "RELEASE_ALL", source: "LIST" });
```

retrying up to 3 times, 2 s apart, while it answers `code` `"409"` (another run is busy). It is released only if
`res.data.code === "200"` **and** `JSON.parse(res.data.result_json).status === "NONE"`. Anything else: **restore the header**
(`is_deleted = 0`), keep the lines, and show "The materials reserved for Item Assembly <no> could not be released, so it was not
deleted." plus the answer's `message`. A deleted IA that still held stock would leave it in Reserved with no owner.

## 6. Saving: what changed in IA_SAVE

- `required_qty` on component lines: send it if the app shows it. A line sent **without** the property keeps its stored value;
  an empty value becomes the line's requested quantity (if above 0), else its total quantity.
- Do not send `res_reserved` / `res_short`: they are screen figures (IA_SAVE drops them).
- A completion while a reservation of the same IA is running answers `code` `"409"`, "The materials of this Item Assembly are
  being reserved right now: try again in a moment." Nothing was written: retry after a moment.
- One completion per IA (22 October): every completion of a stored IA takes a server claim. A second completion of the same IA
  (another device, tab or user) answers `code` `"409"`, "This Item Assembly is being completed in another window or by another
  user: refresh it to see the result." Nothing was written: reload the IA, never retry in a loop.
- A component picked from **Reserved** stock is refused at completion (`400`, "A component is picked from Reserved stock, which
  belongs to another document's reservation: pick it from Unrestricted or Blocked stock instead."). Never offer Reserved in the picker.
- **Manual Required (RF-09):** each component line carries `required_manual` (text). Send `"1"` when the user typed the line's
  Required, `""` when the user cleared it (the line then follows the BOM again). A line sent **without** the property keeps its stored
  flag, so an app that does not show Required changes nothing by leaving it out.

## 7. If mobile does nothing

Mobile Drafts never reserve, so a mobile-only flow is unchanged. For a Created IA (made on desktop), IA_SAVE keeps it Created and
marks it `RESERVING` when mobile saves it, and the desktop form makes the reservation (or the close) when the IA is next opened
there. Until then:

- a Created IA saved on mobile holds what it held before the save;
- a Created IA edited on mobile shows its own held stock as taken in the mobile picker;
- a completed IA keeps its unused holds in Reserved until it is opened on desktop, and cannot be reverted before that
  (the revert refuses while holds are open);
- a mobile delete without the release leaves the holds without an owner (section 5 is the one change that matters most).

## 8. Completion check (optional display, 22 October)

A completed IA can say when its completion did not finish (an issue or the output receipt was refused after the header was written,
or the run stopped). When a stored `Completed` / `Fully Posted` IA is opened, the desktop form calls (in the background, read-only):

```js
const res = await runWorkflow("2112752274794217473", { ia_id, organization_id, operation: "CHECK", source: "FORM" });
const r = res.data.code === "200" && res.data.result_json ? JSON.parse(res.data.result_json) : null;
// show r.message (a warning) only when r.outcome is "PARTIAL", "INTERRUPTED" or "RUNNING"; DONE / NONE / UNKNOWN / NOT_COMPLETED: nothing
```

## 8b. Output split (27 October): the finished good received into several bins / batches

Desktop can split an IA's output across rows (`output_split`: a JSON array on the header; each row `os_qty`, `os_storage_location_id`,
`os_location_id`, `os_category` and, for a batch item, `os_group` / `os_batch_no` / `os_mfg_date` / `os_exp_date`). When it is split the
header's single Output Location fields hold row 1 and `item_qty` stays the total. Mobile needs no change:

- Leave `output_split` out of the save payload. IA_SAVE keeps the stored rows: a mobile completion of a split IA receives every row
  (one ADD_INVENTORY per row, each batch's Batch row created once).
- A save without the key may not change a split IA's plant, item or Output bin: IA_SAVE answers 400 "This Item Assembly's output is
  split across bins: change its plant, item or bin on the desktop." Show the message; do not retry.
- If mobile ever sends `output_split`, send the whole array (ids as strings); `[]` turns the split off.
- Batches (27 October evening): desktop gives every row of a System-numbered item its own batch (it hides the Group column and sets
  `os_group` to the row number, 1..n, so the save generates one number per row). A Manual item's rows with the same typed `os_batch_no`
  are one batch. If mobile ever sends rows of a System-numbered item, set `os_group` to the row number the same way.

## 9. Checklist

- [ ] A Created save = `saveAs: "Draft"` + `allData.ia_target_status: "Created"`; never `saveAs: "Created"`.
- [ ] After a Created save, or any save of an IA with `material_hold_status` set: IA_HOLD RECONCILE, source SAVE.
- [ ] After a completion of a stored IA with `material_hold_status` set: IA_HOLD CLOSE, source COMPLETE.
- [ ] Picker: add this IA's own Allocated holds back (base units, by material + bin + batch + from_category; no HU).
- [ ] Never delete a Created IA (it is cancelled on desktop first); a Cancelled IA is read-only.
- [ ] Delete an IA with `material_hold_status` set: header deleted, RELEASE_ALL (409 retried), released only on 200 + `NONE`, else the header restored and the delete refused.
- [ ] Refuse a delete of Created / Completed / Fully Posted / Processing from the stored status.
- [ ] A 409 "being completed in another window" on a completion: reload, no retry loop. No Reserved category in the picker.
- [ ] `required_manual` "1" / "" only when the app lets the user type Required; otherwise leave the property out.
- [ ] Cancel only from the IA list (bulk, IA_HOLD CANCEL, source LIST), never on the IA's own view; optional: the completion check on a completed IA.
- [ ] Ids as strings everywhere; `organization_id` sent with every IA_HOLD call.
- [ ] Leave `output_split` out of IA saves (a split IA keeps its rows; moving its plant / item / bin answers 400).
- [ ] Optional display: `material_hold_status` label; per line Required / Reserved / Short.
