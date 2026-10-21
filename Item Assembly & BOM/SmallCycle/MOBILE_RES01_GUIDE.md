# Mobile Implementation Guide — Item Assembly raw-material reservation (RES-01)

What the mobile app must add so an Item Assembly (IA) edited on mobile reserves, uses and gives back its component stock the
way the desktop form does.

This guide is a **delta** on the existing mobile IA integration. It assumes the app already saves IAs with
`runWorkflow("2098335576774463489" /* IA_SAVE */, { allData, saveAs, pageStatus })`, has a stock picker for component lines,
and deletes Draft IAs from its list.

> Status (21 October 2026): RES-01 is built behind a switch that is **OFF**. Nothing is needed on mobile until the switch is
> turned on. The switch only decides whether new holds are made; an IA that already holds stock (a stored `material_hold_status`)
> is completed, closed, released and reverted from its holds whatever the switch says, so sections 3 to 5 apply to it always. Even then mobile keeps working without these changes (section 7 says what it costs); the changes make it match
> desktop. Design: `RES01_DESIGN.md` (this folder). Desktop reference handlers: `iaForm_onClick_saveAsDraft.js`,
> `iaForm_onClick_saveAsCompleted*.js`, `iaForm_onClick_select_stock.js`, `sc_main.js` (RES-01 block),
> `../AsyncV2/iaList_delete.js`.

---

## 1. Mental model

- A **hold** is component stock of a Draft IA moved from its category (Unrestricted, or Blocked) into **Reserved**, plus one
  `on_reserved_gd` row: `doc_type = "Item Assembly"`, `doc_id` = the IA id, `doc_line_id` = the component line id,
  `material_id`, `bin_location`, `batch_id`, `from_category`, `open_qty` in `item_uom`, `status = "Allocated"`.
- Holds belong to the IA. Other documents cannot take them; **this** IA may use them (section 4).
- Only the workflow **IA_HOLD** (`2112752274794217473`) creates, changes or ends holds. IA_SAVE never calls it: the client
  does, after IA_SAVE answered.
- The header field `material_hold_status` says where the IA stands:

| Value | Meaning |
|---|---|
| `""` | not enrolled: the IA never reserves (every IA created before the switch, and IAs completed at once) |
| `RESERVING` | saved, reservation not made yet (IA_SAVE sets it) |
| `FULL` / `PARTIAL` / `SHORT` / `NONE` | the last reservation's result (all / some / none of the required stock held / nothing to hold) |
| `REVIEW` | the last reservation did not finish: save again to retry |
| `CLOSED` | completed: what was used is delivered, the rest released |

## 2. After a Draft save: start the reservation

When IA_SAVE answers `code` `"200"` for `saveAs: "Draft"`, and the IA is **new** (`pageStatus` Add or Clone) **or** its
`material_hold_status` is not empty, call:

```js
runWorkflow("2112752274794217473", {
  ia_id: savedId,                 // IA_SAVE's answer `id` (or the IA's id on an edit)
  organization_id: orgId,         // the IA's organization_id, as text
  operation: "RECONCILE",
  source: "SAVE",
});
```

- Up to 50 picks with a quantity: wait for it and show its `message`. Above 50: start it and do not wait (it can take a while).
- Answer: `code` `"200"` with `message` and `result_json` (a JSON string: `{ status, lines, notHeld, short, held, released,
  checkedAt, message }`). An empty `result_json` means there was nothing to reserve (the server did not enrol the IA): show
  nothing.
- `code` `"409"`: another reservation of this IA is running. Do not retry in a loop: the IA is reconciled again when it is next
  opened on desktop, or saved again.
- Keep ids as **strings**. Never `Number()` an id: 19-digit ids lose their last digits.

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

## 5. Deleting a Draft: release first

Before deleting a Draft whose stored `material_hold_status` is not empty (re-read it; the list can be stale):

```js
const res = await runWorkflow("2112752274794217473", { ia_id, organization_id, operation: "RELEASE_ALL", source: "LIST" });
```

Delete only if `res.data.code === "200"` **and** `JSON.parse(res.data.result_json).status === "NONE"`. Anything else (409
busy, `REVIEW`, a failed call): refuse the delete and show "The materials reserved for Item Assembly <no> could not be
released, so it was not deleted." plus the answer's `message`. A deleted IA that still held stock would leave it in Reserved
with no owner.

## 6. Saving: what changed in IA_SAVE

- `required_qty` on component lines: send it if the app shows it. A line sent **without** the property keeps its stored value;
  an empty value becomes the line's requested quantity (if above 0), else its total quantity.
- Do not send `res_reserved` / `res_short`: they are screen figures (IA_SAVE drops them).
- A completion while a reservation of the same IA is running answers `code` `"409"`, "The materials of this Item Assembly are
  being reserved right now: try again in a moment." Nothing was written: retry after a moment.

## 7. If mobile does nothing

The switch-on is still safe: IA_SAVE marks an enrolled IA saved on mobile `RESERVING`, and the desktop form makes the
reservation (or the close) when the IA is next opened there. Until then:

- a Draft saved on mobile holds what it held before the save (or nothing, if new);
- a Draft edited on mobile shows its own held stock as taken in the mobile picker;
- a completed IA keeps its unused holds in Reserved until it is opened on desktop, and cannot be reverted before that
  (the revert refuses while holds are open);
- a mobile delete without the release leaves the holds without an owner (section 5 is the one change that matters most).

## 8. Checklist

- [ ] After a Draft save (new IA, or `material_hold_status` set): IA_HOLD RECONCILE, source SAVE.
- [ ] After a completion of a stored IA with `material_hold_status` set: IA_HOLD CLOSE, source COMPLETE.
- [ ] Picker: add this IA's own Allocated holds back (base units, by material + bin + batch + from_category; no HU).
- [ ] Delete: RELEASE_ALL first; delete only on 200 + `NONE`.
- [ ] Ids as strings everywhere; `organization_id` sent with every IA_HOLD call.
- [ ] Optional display: `material_hold_status` label; per line Required / Reserved / Short.
