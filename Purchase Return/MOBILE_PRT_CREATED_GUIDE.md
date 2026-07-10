# Purchase Return: Created / Completed (Mobile Handoff)

## What this is

Desktop Purchase Return moved from a two-state save (`Draft → Issued`) to a three-state one
(`Draft → Created → Completed`). Mobile already has the old screen; this document is the **delta**.

The load-bearing idea: a **Created** purchase return is *intent to return*. It saves the document
and **reserves** the return quantity against the goods receiving and purchase order lines — but it
moves **no inventory**. Completing it releases that reservation and performs the real deduction.
This mirrors Goods Receiving's own `Created` status, where the reservation column is
`created_received_qty`.

Four of the six changes below are not cosmetic. If mobile skips them it will strand reservations,
duplicate document numbers, or subtract one quantity from inventory while booking a different one
onto the GR and PO. Sections 8, 9, 10 and 11 are the ones that corrupt data.

Every snippet here is copied verbatim from the shipped desktop source.

---

## Table of contents

1. [Background / why](#1-background--why)
2. [Server prerequisites](#2-server-prerequisites)
3. [Workflow contracts](#3-workflow-contracts)
4. [Status state machine — and what the server does for you](#4-status-state-machine--and-what-the-server-does-for-you)
5. [Save wrappers](#5-save-wrappers)
6. [Status display](#6-status-display)
7. [Field enable/disable matrix](#7-field-enabledisable-matrix)
8. [Per-row disable — the silent corrupter](#8-per-row-disable--the-silent-corrupter)
9. [Returnable-quantity guard](#9-returnable-quantity-guard)
10. [Clone](#10-clone)
11. [Bulk Cancel + Delete](#11-bulk-cancel--delete)
12. [Known gaps — do not re-introduce](#12-known-gaps--do-not-re-introduce)
13. [Test checklist](#13-test-checklist)

---

## 1. Background / why

Before, hitting the one non-draft button immediately subtracted inventory, unloaded handling units,
and rolled `return_quantity` up to the GR and PO. There was no way to record a return that had been
agreed but whose goods had not physically left.

Now:

| Status | Inventory | Reservation | Document editable |
|---|---|---|---|
| `Draft` | none | none | fully |
| `Created` | none | `created_return_qty` on GR line **and** PO line | yes, except identity fields |
| `Completed` | subtracted, HUs unloaded | released back to 0 | no |
| `Cancelled` | none | released back to 0 | no |

`Issued` is legacy. Nothing writes it any more; it only needs to still *render* for old records.

---

## 2. Server prerequisites

These are platform-side schema changes. They must exist before mobile ships, and they are shared
with the desktop client — check they are already applied rather than adding them again.

1. `created_return_qty` — decimal, default `0` — on `goods_receiving.table_gr[]`
2. `created_return_qty` — decimal, default `0` — on `purchase_order_2ukyuanr_sub` (collection id `1939901372270747649`)
3. `"Created"` added to the option list of `goods_receiving.return_status`
   (it previously held only `""` / `"Partially Returned"` / `"Fully Returned"`)
4. `"Created"` and `"Completed"` added to the option list of `purchase_return_head.purchase_return_status`

---

## 3. Workflow contracts

| Workflow | Platform id | Request | Success response |
|---|---|---|---|
| `PRTsaveWorkflow` | `2066433188188499969` | `{ allData, saveAs, pageStatus }` | `{ code: "200", message, id }` |
| `PRTcancelWorkflow` | `2075396495149031426` | `{ action, prt_id }` | `{ code: "200", message }` |

- `saveAs` ∈ `"Draft"` | `"Created"` | `"Completed"`
- `pageStatus` ∈ `"Add"` | `"Edit"` | `"Clone"` — send `allData.page_status`
- `action` ∈ `"cancel"` | `"delete"`

**Every failure returns `code: "400"` with a `message`.** There are no interactive confirmation
codes here — unlike Goods Receiving, which uses `401` (zero qty) and `402` (over-commitment). The
only prompt Purchase Return needs, the zero-return-quantity confirm, is resolved on the client
*before* the workflow is called. So the result handler is just: `200` → success, anything else →
show `message`.

`PRTcancelWorkflow` declares no `response_json`, but still returns `code` and `message` — read them
off `workflowResult.data` exactly as you do for the save workflow.

---

## 4. Status state machine — and what the server does for you

```
Draft ──save as Created──▶ Created ──save as Completed──▶ Completed
  │                          │
  │                          └──bulk cancel──▶ Cancelled
  └──save as Completed──▶ Completed        (skips Created entirely; supported)
```

What `PRTsaveWorkflow` does per `saveAs`, so you know what mobile is **not** responsible for:

| Step | Draft | Created | Completed |
|---|---|---|---|
| Persist header + lines | yes | yes | yes |
| Generate document number | yes (`draft` token) | yes (`issued` token) | yes, or keeps the Created one |
| Drop zero-return-qty lines | no | yes | yes |
| Validate returnable quantity | no | yes (before persist) | yes (before persist) |
| Validate `temp_qty_data` | no | **no** | yes |
| Check inventory sufficiency | no | **no** | yes |
| Reserve `created_return_qty` | no | yes | released |
| `SUBTRACT_INVENTORY` | no | **no** | yes |
| Handling-unit unload | no | **no** | yes |
| GR `return_status` | untouched | `"Created"` | `"Partially"` / `"Fully Returned"` |
| Item `last_transaction_date` | no | **no** | yes |

Mobile sends `saveAs` and changes nothing else about its payload. A Created save does not require
the user to have opened the Select Stock dialog.

The reservation arithmetic is entirely server-side, and it *diffs* against the pre-edit document:
re-saving a Created return whose quantity went from 5 to 3 leaves `created_return_qty` at 3, not 8.
Completing releases the **original reserved quantity** and books the **new** one in a single write.

---

## 5. Save wrappers

The Draft and Completed wrappers are unchanged in shape — only the status they produce. The Created
wrapper is new.

> **Trap, learned the hard way.** On desktop, the Created and Completed buttons initially shipped
> bound to *byte-identical* scripts, both sending `saveAs: "Completed"`. The Created button silently
> completed the return: it subtracted inventory and unloaded handling units. **Verify your Created
> button actually sends `saveAs: "Created"`** before you test anything else.

`PRTsaveAsCreated.js` — the zero-return-qty `$confirm` is the *only* client responsibility, because
a workflow cannot prompt. The workflow drops those rows once the user agrees.

```js
// Thin wrapper: the ONLY client-side responsibility is the interactive
// zero-return-qty confirm (a workflow can't prompt the user). All data
// transforms (drop zero lines, reserve created_return_qty on the GR/PO lines,
// doc no, status) live in PRTsaveWorkflow's saveAs: "Created" branch.
// A Created purchase return reserves the return quantity but moves no inventory.
const PRT_SAVE_WORKFLOW_ID = "2066433188188499969";

const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
  }
};

(async () => {
  try {
    this.showLoading("Saving Purchase Return as Created...");
    const data = this.getValues();
    const lines = data.table_prt || [];

    // Block when nothing is being returned
    const totalQty = lines.reduce(
      (sum, item) => sum + (parseFloat(item.return_quantity) || 0),
      0,
    );
    if (totalQty === 0) {
      this.hideLoading();
      this.$message.error("Total return quantity is 0.");
      return;
    }

    // Interactive confirm for zero-qty lines (the workflow drops them on save)
    const zeroQtyArray = [];
    lines.forEach((item, index) => {
      if (!(parseFloat(item.return_quantity) > 0)) zeroQtyArray.push(`#${index + 1}`);
    });
    if (zeroQtyArray.length > 0) {
      try {
        await this.$confirm(
          `Line${zeroQtyArray.length > 1 ? "s" : ""} ${zeroQtyArray.join(", ")} ha${
            zeroQtyArray.length > 1 ? "ve" : "s"
          } a zero return quantity, which may prevent processing.\nIf you proceed, it will delete the row with 0 return quantity.\nWould you like to proceed?`,
          "Zero Return Quantity Detected",
          {
            confirmButtonText: "OK",
            cancelButtonText: "Cancel",
            type: "warning",
            dangerouslyUseHTMLString: false,
          },
        );
      } catch {
        this.hideLoading();
        return; // user cancelled
      }
    }

    let workflowResult;
    await this.runWorkflow(
      PRT_SAVE_WORKFLOW_ID,
      { allData: data, saveAs: "Created", pageStatus: data.page_status },
      async (res) => {
        workflowResult = res;
      },
      (err) => {
        console.error("Failed to save Purchase Return as Created:", err);
        this.hideLoading();
        workflowResult = err;
      },
    );

    if (!workflowResult || !workflowResult.data) {
      this.hideLoading();
      this.$message.error("No response from workflow");
      return;
    }

    const code = workflowResult.data.code;
    if (code === "200" || code === 200 || workflowResult.data.success === true) {
      this.hideLoading();
      this.$message.success(
        workflowResult.data.message ||
          workflowResult.data.msg ||
          "Purchase Return saved as Created successfully",
      );
      closeDialog();
    } else {
      this.hideLoading();
      this.$message.error(
        workflowResult.data.msg ||
          workflowResult.data.message ||
          "Failed to save Purchase Return as Created",
      );
    }
  } catch (error) {
    this.hideLoading();
    console.error("Error:", error);
    this.$message.error(error.message || error || "Failed to save Purchase Return as Created");
  }
})();
```

The Completed wrapper is the same file with `saveAs: "Completed"` and the wording changed. Adapt the
`$confirm` / `$message` / `closeDialog` calls to whatever mobile uses.

---

## 6. Status display

Keep the `Issued` case. Nothing writes it any more, but records saved before this change still carry
it and must still render a badge.

```js
const showStatusHTML = async (status) => {
  switch (status) {
    case "Draft":
      this.display(["draft_status"]);
      break;
    case "Created":
      this.display(["created_status"]);
      break;
    case "Completed":
      this.display(["completed_status"]);
      break;
    // Legacy: purchase returns saved before the Created/Completed split.
    case "Issued":
      this.display(["issued_status"]);
      break;
    case "Cancelled":
      this.display(["cancelled_status"]);
      break;
  }
};
```

---

## 7. Field enable/disable matrix

| Status | Header fields | `table_prt` | Buttons shown |
|---|---|---|---|
| `Draft` | all editable | editable | Draft, Created, Completed |
| `Created` | identity fields frozen, rest editable | editable | Created, Completed |
| `Completed` / `Cancelled` / `Issued` | all frozen | **frozen** | none |

"Identity fields" are the five that must not change once a reservation exists against them:
`purchase_return_status`, `purchase_return_no`, `organization_id`, `supplier_id`, `plant`.

```js
const disabledField = async (status) => {
  if (status === "Draft") return;

  // Created: the return quantity is reserved against the GR/PO lines but no
  // stock has moved yet, so the document can still be corrected or completed.
  // Only the identity fields are frozen.
  if (status === "Created") {
    this.disabled(
      [
        "purchase_return_status",
        "purchase_return_no",
        "organization_id",
        "supplier_id",
        "plant",
      ],
      true,
    );

    this.hide(["button_save_as_draft"]);
    this.display(["button_save_as_created", "button_save_as_completed"]);
    return;
  }

  // Completed / Cancelled (and legacy Issued): fully read-only.
  this.disabled(
    [
      "purchase_return_status",
      "purchase_return_no",
      /* … all header fields … */
      "table_prt",                 // ← desktop originally omitted this
      "table_prt.return_condition",
      "confirm_inventory.table_item_balance",
      /* … address fields … */
    ],
    true,
  );

  this.hide([
    "link_billing_address",
    "link_shipping_address",
    "button_save_as_draft",
    "button_save_as_created",
    "button_save_as_completed",
  ]);
};
```

Two things worth calling out:

**`"table_prt"` itself must be in the read-only list.** Desktop listed only
`"table_prt.return_condition"`, so on a Completed return the line table stayed interactive — you
could still open the Select Stock dialog and retype quantities. Nothing could be saved (the buttons
are hidden), but don't repeat it. Goods Receiving disables `"table_gr"` in its equivalent branch.

**Hiding the buttons is the only guard against editing a Completed return.** There is no
server-side check; the save workflow would happily re-deduct inventory. See §12.

---

## 8. Per-row disable — the silent corrupter

This one has no visible symptom until the stock ledger disagrees with the returns ledger.

A **stock row** (has `material_id`) gets its `return_quantity` from the Select Stock dialog, which
writes `temp_qty_data` and `return_quantity` **together**. A **description-only row** (no
`material_id`, but a `material_desc`) has no stock behind it, so its quantity is typed directly.

On desktop, `processData()` in `PRTbatchAddLineItem.js` enforces that split — but it only runs when
rows are **added**. Nothing replayed it when a document was reopened. So on Edit, a stock row's
`return_quantity` was a plain editable number.

Type `7` into a row whose `temp_qty_data` says `3`, then complete:

- validation only checks that *some* temp entry is `> 0` → passes
- the inventory loop subtracts per `temp_qty_data` → **3 leaves stock**
- the GR/PO sync books `line.return_quantity` → **7 lands on the ledger**

Silent, permanent divergence. At `Created` it's quieter but the same: you reserve 7 against a line
you will only ever return 3 of.

Replay the rule on **Clone** and on **Edit of Draft or Created**:

```js
// Mirrors processData() in PRTbatchAddLineItem.js. A stock row's quantity comes from
// the Select Stock dialog, which writes temp_qty_data and return_quantity together; a
// description-only row is typed directly. processData only runs when rows are added,
// so without replaying it on reopen a stock row's return_quantity stays editable and
// can drift away from temp_qty_data — completion would then subtract one quantity from
// inventory while booking a different one onto the goods receiving and purchase order.
const disabledRowFields = async () => {
  const data = this.getValues();

  (data.table_prt || []).forEach((prt, index) => {
    const isDescriptionRow = !prt.material_id && prt.material_desc !== "";
    this.disabled(`table_prt.${index}.select_return_qty`, isDescriptionRow);
    this.disabled(`table_prt.${index}.return_quantity`, !isDescriptionRow);
  });
};
```

Wired into the page-status switch:

```js
case "Edit":
  this.setData({ previous_status: status });
  await disabledField(status);
  // Only the two editable statuses need per-row state; the rest disable
  // table_prt wholesale.
  if (status === "Draft" || status === "Created") {
    await disabledRowFields();
  }
  await checkAccIntegrationType(organizationId);
  await showStatusHTML(status);
  await displayDeliveryMethod();
  await displayAddress();
  break;
```

Note the edge case, which the desktop version handles and yours must too: a row with **no**
`material_id` and an **empty** `material_desc` is *not* a description row — it falls to the stock
branch. `!prt.material_id && prt.material_desc !== ""` is the exact predicate.

---

## 9. Returnable-quantity guard

Returnable quantity on a GR line is now:

```
received_qty − (return_quantity + created_return_qty)
```

`return_quantity` is what previous returns actually returned; `created_return_qty` is what Created
returns have reserved but not yet shipped. Both consume the line.

Fold them into the single `returned_quantity` snapshot you already write onto each new PRT row when
building lines from a GR — then the fully-returned filter and the Select Stock dialog's cap
(`received_qty - returned_quantity`) both net out live reservations with no further change.

```js
// Quantity of a GR line already spoken for: what previous purchase returns have
// actually returned, plus what Created (not yet completed) returns have reserved.
const consumedQty = (grItem) =>
  parseFloat(
    (
      parseFloat(grItem.return_quantity || 0) +
      parseFloat(grItem.created_return_qty || 0)
    ).toFixed(3),
  );
```

Use it at both line-build sites (returning by Document and by Item):

```js
returned_quantity: consumedQty(grItem),
```

And fix the fully-returned filter while you're there — float equality lets a fully-returned line
slip through when the two sides differ by rounding:

```js
tablePRT = tablePRT.filter(
  (prt) =>
    prt.returned_quantity < prt.received_qty &&     // was: !== 
    !existingPRT.find((prtItem) => prtItem.gr_line_id === prt.gr_line_id),
);
```

**Self-exclusion is not a problem.** When you reopen a Created return, its rows come from the saved
document carrying the `returned_quantity` snapshotted at creation time — so a Created return never
nets out its own reservation against itself.

**But that snapshot goes stale, and the server is the real gate.** It is frozen when the row is
added. If a *sibling* purchase return returns or reserves against the same GR line afterwards, a
reopened Created document's dialog cap will still offer the original amount. The save workflow
therefore re-validates every line **before it writes anything**, and returns `400` with:

```
Return quantity exceeds what is still returnable on the goods receiving:
Widget: returning 10, only 3 still returnable
```

Its arithmetic, per GR line: `available = received_qty − return_quantity − created_return_qty + (this document's own prior reservation)`.
Treat that `400` as a normal validation failure and show the message; nothing has been persisted.
Do not try to reproduce the check on the client — the server owns it.

**Each PRT line must carry `gr_id`, `gr_line_id`, `po_id` and `po_line_id`.** These four are what
the server aggregates the reservation by. A line missing them reserves nothing, silently — no error,
no reservation. If mobile has any code path that rebuilds `table_prt` from a goods receiving without
setting them, it must be fixed or removed.

---

## 10. Clone

If mobile supports copying a purchase return, clear three fields on load:

```js
// A clone is a brand new draft. Without clearing the number and status it
// inherits the source document's purchase_return_no — the workflow only
// regenerates when the number is blank or the previous status was Draft —
// and would save under a duplicate number.
case "Clone":
  this.display(["draft_status"]);
  this.setData({
    purchase_return_no: null,
    purchase_return_status: null,
    previous_status: null,
    return_by: this.getVarGlobal("nickname"),
  });
  await checkAccIntegrationType(organizationId);
  await disabledRowFields();
  await displayDeliveryMethod();
  await displayAddress();
  break;
```

Without this, the clone saves under a **duplicate document number**, because the workflow only
regenerates when the number is blank or `previous_status === "Draft"` — and a clone satisfies
neither.

Do **not** call `setPlant()` here: at parent-org level it disables `table_prt` wholesale, which would
lock the very lines the clone exists to carry over.

---

## 11. Bulk Cancel + Delete

Both are list-page multi-select actions, and both call the **same** workflow with a different
`action`. Both wrappers are **zero-DB**: filter the selection, one confirm, loop the workflow once
per record, aggregate the results into a single toast.

|  | Allowed statuses | What the server does |
|---|---|---|
| **Cancel** | `Created` only | releases `created_return_qty` on every GR + PO line the return touched, recomputes GR `return_status`, sets `Cancelled`, appends `-Cancelled` to the number to free it |
| **Delete** | `Draft` or `Cancelled` only | sets `is_deleted: 1` |

Deleting a `Created` return is **blocked server-side** — it would strand the reservation forever.
The workflow returns `400` with `"Cancel this purchase return before deleting it."` Cancelling a
`Completed` return is likewise blocked (`"A completed purchase return cannot be cancelled; its
stock has already been returned."`). The client-side filters below are UX, not the gate.

Cancel is idempotent: releases clamp at zero, so a retry after a partial failure cannot drive a
quantity negative or double-append `-Cancelled`.

```js
// Bulk Cancel Created Purchase Returns - releases the created_return_qty reserved
// on the GR and PO lines (server-side workflow). Zero client-side DB access.
const PRT_CANCEL_WORKFLOW_ID = "2075396495149031426";

const runPRTCancelWorkflow = async (prtId) => {
  return new Promise((resolve, reject) => {
    this.runWorkflow(
      PRT_CANCEL_WORKFLOW_ID,
      {
        action: "cancel",   // "delete" for the Delete action
        prt_id: prtId,
      },
      (res) => {
        console.log("Purchase Return cancel workflow response:", res);
        resolve(res);
      },
      (err) => {
        console.error("Failed to cancel Purchase Return:", err);
        reject(err);
      },
    );
  });
};

(async () => {
  try {
    const listID = "custom_d1fjv5r9";   // mobile's list component id will differ

    const selectedRecords = this.getComponent(listID)?.$refs.crud.tableSelect;

    if (!selectedRecords || selectedRecords.length === 0) {
      this.$message.error("Please select at least one record.");
      return;
    }

    // Only Created purchase returns can be cancelled. A Completed one has already
    // moved stock; a Draft never reserved anything.
    const createdPRTs = selectedRecords.filter(
      (item) => item.purchase_return_status === "Created",
    );

    if (createdPRTs.length === 0) {
      this.$message.error(
        "Please select at least one created purchase return.",
      );
      return;
    }

    const prtNumbers = createdPRTs.map((item) => item.purchase_return_no);

    await this.$confirm(
      `You've selected ${prtNumbers.length} purchase return(s) to cancel.<br><br>` +
        `<strong>Purchase Return Numbers:</strong><br>` +
        `${prtNumbers.join(", ")}<br><br>` +
        `This will release the reserved return quantities on the linked goods receiving and purchase orders. Do you want to proceed?`,
      "Cancel Created Purchase Return",
      {
        confirmButtonText: "Yes, Cancel Purchase Returns",
        cancelButtonText: "No, Go Back",
        type: "warning",
        dangerouslyUseHTMLString: true,
      },
    ).catch(() => {
      throw new Error("User cancelled the operation");
    });

    this.showLoading("Cancelling Purchase Return...");

    const results = [];
    for (const prtItem of createdPRTs) {
      try {
        const workflowResult = await runPRTCancelWorkflow(prtItem.id);

        const resultCode = workflowResult?.data?.code;
        if (resultCode === "200" || resultCode === 200) {
          results.push({ prt_no: prtItem.purchase_return_no, success: true });
        } else {
          results.push({
            prt_no: prtItem.purchase_return_no,
            success: false,
            error:
              workflowResult?.data?.message ||
              workflowResult?.data?.msg ||
              "Failed to cancel purchase return",
          });
        }
      } catch (error) {
        results.push({
          prt_no: prtItem.purchase_return_no,
          success: false,
          error: error.message || "Failed to cancel purchase return",
        });
      }
    }

    this.hideLoading();

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    if (failCount > 0) {
      // Escape interpolated values; only the literal <br> stays as HTML.
      const esc = (s) =>
        String(s)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      const failedItems = results
        .filter((r) => !r.success)
        .map((r) => `${esc(r.prt_no)}: ${esc(r.error)}`)
        .join("<br>");
      this.$message({
        type: "error",
        message: `${successCount} succeeded, ${failCount} failed:<br>${failedItems}`,
        dangerouslyUseHTMLString: true,
      });
    } else {
      this.$message.success(
        `Successfully cancelled ${successCount} purchase return(s).`,
      );
    }

    this.refresh();
  } catch (error) {
    this.hideLoading();
    console.error(error);
  }
})();
```

**Delete** is the same file with three differences: `action: "delete"`, the filter becomes
`status === "Draft" || status === "Cancelled"`, and the workflow call takes only `{ action, prt_id }`.
If mobile's delete currently writes `is_deleted` directly via `db.collection("purchase_return_head")`,
**replace it** — the direct write has no status guard and would strand a Created return's reservation.

If the `esc()` helper looks paranoid: those values are interpolated into a string rendered as HTML.
A supplier name or an error message containing `<` would otherwise break the toast.

---

## 12. Known gaps — do not re-introduce

Three things the desktop implementation knowingly does not handle. Mobile should not paper over them
independently, and should not be surprised by them.

**Serialized items mix units of measure.** When building PRT lines, `received_qty` is converted to
the item's base UOM for serialized items, but `return_quantity` and `created_return_qty` come off the
GR line in the GR's UOM and are **not** converted. So `received_qty - returned_quantity` subtracts
across two different units. This predates the Created work; `consumedQty()` simply inherits it. If
you fix it, fix desktop too.

**The reservation sync truncates silently.** The save workflow's `search_grHeads` fetches at most 100
goods receivings and `search_poLines` at most 200 purchase-order lines. A purchase return spanning
more than that would sync a subset with no warning. Unlikely in practice; worth knowing.

**Nothing on the server stops an edit of a Completed purchase return.** If a `Completed` document is
ever submitted with `pageStatus: "Edit"`, the workflow will re-subtract inventory and re-add
`return_quantity`. The *only* thing preventing this is the UI hiding the save buttons. **Mobile must
hide them too** — see §7.

---

## 13. Test checklist

Each of these was verified against the desktop code by executing the workflow's reservation
arithmetic against fixtures. Run the equivalent on mobile.

### Reservation lifecycle

- [ ] **Draft → Created.** Two lines from one GR. Status is `Created`, a number is generated, **no
      inventory movement rows**, no HU unload. GR line `created_return_qty` = the return quantity, GR
      `return_status` = `"Created"`, PO sub-line `created_return_qty` bumped, `return_quantity` still
      `0` everywhere.
- [ ] **Created → re-save Created with a changed quantity** (5 → 3). `created_return_qty` ends at
      **3, not 8**. The server diffs against the pre-edit document.
- [ ] **Created → Completed.** `created_return_qty` back to `0`, `return_quantity` = 3, GR
      `return_status` = `"Partially Returned"`, inventory subtracted, HUs unloaded, item
      `last_transaction_date` updated.
- [ ] **Draft → Completed directly**, skipping Created. `created_return_qty` stays `0`,
      `return_quantity` = the full quantity.
- [ ] **Created → Completed with the quantity changed** (reserved 5, complete 3). Reservation fully
      clears to `0`; `return_quantity` = 3. No phantom 2 left behind.

### The line-removal leak

- [ ] On a Created return spanning **two** goods receivings, set line B's quantity to `0` and re-save
      as Created. **GR2's reservation must be released.** (The zero line is dropped on save; the
      server's fetch set is the union of the new and pre-edit lines, so it still reaches GR2.)
- [ ] Same, but delete line B outright rather than zeroing it. Same result.
- [ ] Same, but complete the document instead of re-saving as Created. B's reservation clears, A's
      converts to `return_quantity`.

### Split goods receiving

- [ ] Return a split GR line **in full**. `return_status` must become `"Fully Returned"`, not
      `"Partially Returned"`. Only parent/regular rows are returnable — the children are per-bin
      detail and must be excluded from the status count. (Note: GR's *own* workflows use the
      opposite convention and skip the parent. Don't copy one into the other.)

### Guards

- [ ] With a Created return reserving 3 of 10 received, open a **new** purchase return and add the
      same GR line — the Select Stock dialog must cap at **7**.
- [ ] Cancel that Created return, then repeat — the cap is back to **10**.
- [ ] **Stale-snapshot over-return.** Create PRT-A reserving 3 of 10. Separately complete PRT-B
      returning 7. Reopen PRT-A, raise its quantity to 10 (the dialog cap will *allow* it — the
      snapshot is stale) and save. The server must reject with `400`
      "…only 3 still returnable", and **nothing may be persisted**: PRT-A is still `Created` with
      quantity 3, and the GR line still reads `return_quantity 7 / created_return_qty 3`.
- [ ] Same setup, raise PRT-A to exactly **3** → accepted.
- [ ] Cancel a `Draft` or a `Completed` return → `400` with a clear message.
- [ ] Delete a `Created` return → `400`, "Cancel this purchase return before deleting it."
- [ ] Delete a `Draft` or `Cancelled` return → `is_deleted = 1`.
- [ ] Cancel an already-cancelled return → blocked; and even if forced, the number does not gain a
      second `-Cancelled` suffix.

### Form state

- [ ] Reopen a `Created` return: a **stock row's** `return_quantity` is **not** typeable; its Select
      Stock button is enabled. A **description row** is the reverse.
- [ ] Reopen a `Completed` return: `table_prt` is fully locked and no save button is visible.
- [ ] Clone any return: the number field is blank and a **fresh** number is generated on save.
- [ ] Open a legacy `Issued` return in view mode: the badge still renders.
