# Mobile Client Migration: Server-Side Batch Number Generation

**Audience:** Mobile client developers
**Scope:** Goods Receiving, Misc Receipt, Plant Transfer (Completed saves)
**Status:** Web clients + save workflows already updated. Mobile needs the matching client change.

---

## Background / Why

Auto batch-number generation used to run **on the client** (web *and* mobile) before the save was sent to the workflow. The client had a `processRow`-style function that:

1. Looked up the old `batch_level_config` collection,
2. Built a batch number from a date + prefix + running number,
3. Replaced the line's batch field (`"Auto-generated batch number"` placeholder) with the generated value,
4. Incremented the running number,
5. *(GR & Misc Receipt only)* also did split parent/child batch inheritance and recalculated the parent quantity from its children,
6. Then sent the data to the save workflow.

This has now been **moved into the save workflows** (server-side), which generate the number by calling the shared **`GlobalGenerateBatch`** workflow (the new *Batch Number Configuration* system, **not** `batch_level_config`). Generation happens during the workflow's checking phase, before any inventory is written, so a failure aborts cleanly.

**Consequence:** if the mobile client *also* generates the batch number before sending, you'll get **double generation** (two running numbers consumed, mismatched values, or the old `batch_level_config` system fighting the new one). The mobile client must therefore **stop generating** and just send the placeholder.

---

## The new contract (what mobile must send)

For each line where the user selected auto-generated batching, send the batch field set to the **exact literal string**:

```
Auto-generated batch number
```

That's the signal the workflow uses to decide which rows to generate for. Do **not** pre-generate, do **not** touch `batch_level_config`.

Everything else about the save call is unchanged:
- Same workflow IDs and params (`allData`, `saveAs`, `pageStatus`).
- Keep sending all line fields, including the split fields (`is_split`, `parent_or_child`, `parent_index`) and `manufacturing_date` / `expired_date` — **the workflow needs them** to do parent/child inheritance and quantity recalculation server-side.

---

## What to remove on mobile (per module)

If the mobile client mirrors the web structure, each module's "save as completed" handler has a `processRow` function plus a loop that calls it. Remove the **generation logic only**; keep the normal save flow (loading state, `getValues`/payload build, workflow call, result handling).

| Module | Workflow ID | Line table | Batch field | Extra client logic to remove |
|---|---|---|---|---|
| **Goods Receiving** | `2029090678383042562` | `table_gr` | `item_batch_no` | split parent/child inheritance + parent `received_qty`/`base_received_qty` recalc |
| **Misc Receipt** (Completed **and** Completed & Post) | `2014528394297737217` | `stock_movement` | `batch_id` | split parent/child inheritance + parent `received_quantity`/`amount` recalc |
| **Plant Transfer** (Completed) | `2025864403783462913` | `stock_movement` | `batch_no` | the `plant_transfer_setup` fetch + the `generate_new_batch` gate that wrapped generation (no split logic in PT) |

### Remove specifically:
1. The `processRow` (or equivalently named) function that reads `batch_level_config` and builds the batch string.
2. The loop that iterates the line table and calls it before the workflow call.
3. *(GR, Misc Receipt)* the post-loop block that copies the parent's batch/dates to child rows and recalculates the parent's quantity (and amount, for Misc Receipt) — now done server-side.
4. *(Plant Transfer)* the client `plant_transfer_setup` lookup and the `if (generate_new_batch) { … }` wrapper around generation. The workflow already validates the setup exists and reads `generate_new_batch` itself.
5. Any now-unused helper variables (e.g. an `organizationId` that was only used by the removed code).

### Keep:
- Loading / disabling UI, the `getValues()`/payload assembly, the workflow invocation, and the result handling (success/error toasts, dialog close).
- For **Misc Receipt – Completed & Post**: keep the post-completion accounting/posting step and anything it needs (e.g. `organizationId` is still used by the posting call there — do not delete it in that variant).

---

## Module-specific notes

- **Plant Transfer gating:** generation only happens when `plant_transfer_setup.generate_new_batch = 1`. The server now enforces this, so mobile must **not** re-implement the gate — just send the placeholder; if the flag is off the server leaves the batch as the moving/source batch.
- **Plant Transfer "In Progress":** if mobile has a separate "Save as In Progress / Receive" action, no client change is needed there — that path stores the placeholder and it is resolved when the document is later completed.
- **Draft saves:** unchanged. The placeholder is persisted as-is for drafts and only resolved when the document is completed. Don't generate for drafts.

---

## New error behavior to handle

Because generation is now server-side, the save workflow can return a **business error** when no batch configuration exists, e.g.:

```
code: 400
message: "Failed to generate batch number. Please ensure a Batch Number
          Configuration is set up for this item or organization."
```

Mobile should surface the workflow's returned `message` (it most likely already does this for other `400`s). No inventory/records are written when this happens, so the user can fix the config and retry safely.

---

## Test checklist (mobile)

- [ ] Auto-batch line on a Completed save → server generates a unique number; record + inventory show the real batch, not the placeholder.
- [ ] No double generation (running number advances by exactly the number of generated lines).
- [ ] *(GR/Misc Receipt)* Split: parent generates, children inherit the parent's batch + dates, parent quantity equals the sum of its children — all without client code doing it.
- [ ] *(Plant Transfer)* `generate_new_batch = 0` → source batch preserved (no new number); `= 1` → new number generated.
- [ ] No Batch Number Configuration → friendly `400` message shown, nothing saved.
- [ ] Draft save → batch field still shows the placeholder, no generation.
- [ ] Misc Receipt **Completed & Post** still posts after a successful save.

---

## Reference: web client changes (for parity)

These web files had their `processRow` + generation loop removed (use them as the diff reference):
- `Goods Receiving/GRworkflowCompleted.js`
- `Stock Movement/Misc Receipt/MSRsaveAsCompleted.js`
- `Stock Movement/Misc Receipt/MSRsaveAsCompleted&Post.js`
- `Stock Movement/Plant Transfer/PTsaveAsCompleted.js`
