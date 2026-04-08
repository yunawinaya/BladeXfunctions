# GD Split Policy Design

## Context

The Goods Delivery (GD) module currently allows unrestricted partial picking from Handling Units (HUs). There is no configurable policy to control how HUs are picked. Different warehouse operations need different levels of control:

- **Piece-picking warehouses** need partial picks (current behavior)
- **Bulk/wholesale warehouses** need full-pallet/full-HU picks to avoid breaking HUs on the floor
- **Pre-packed/kit warehouses** need strict matching where HUs must align with delivery contents

This design introduces a `split_policy` field in `picking_setup` to govern HU picking behavior in both manual inventory dialog and auto-allocation.

---

## Configuration

**Collection:** `picking_setup`  
**New field:** `split_policy`  
**Type:** String enum  
**Values:** `"ALLOW_SPLIT"` | `"FULL_HU_PICK"` | `"NO_SPLIT"`  
**Default:** `"ALLOW_SPLIT"` (backward compatible)  
**Scope:** Organization-level (one policy per org via picking_setup)

---

## Policy Definitions

### 1. ALLOW_SPLIT (Default — Current Behavior)

**Intent:** Maximum flexibility. Pickers take exactly what they need from any HU.

**Rules:**

- User can enter any `deliver_quantity` on an HU item row, as long as `deliver_quantity <= available_qty`
- No restrictions on partial picks
- HU can contain mixed items — user only picks the matching material
- Auto-allocation can freely split quantities across multiple HUs

**No code changes required** — this is the existing behavior preserved as the default.

---

### 2. FULL_HU_PICK

**Intent:** Pick the entire HU as a unit. All contents are picked. Excess is flagged for handling at the pack station.

**Manual Dialog Rules:**

- HU item rows: `deliver_quantity` field is **locked/read-only**, auto-filled with full `item_quantity`
- HU header rows: add a **select checkbox**. Checking it = pick ALL items in the HU at full quantities
- User's choice is binary: select the HU or don't
- All HUs containing the current material are shown (no additional filtering vs today)

**What happens when an HU is selected (for GD Line X):**

1. **Matching item (same material as Line X):**
   - Allocate up to Line X's remaining need toward fulfillment
   - If HU qty > remaining need, the excess qty is recorded but does not fulfill beyond the GD line qty

2. **Item matching another GD line Y:**
   - **Add to** Line Y's existing `temp_qty_data` and `temp_hu_data` (preserve any prior allocations)
   - Cap at Line Y's remaining need; excess beyond that is flagged
   - Line Y's inventory dialog will show these allocations as pre-filled when opened
   - If Line Y is already fully allocated, entire qty for that item becomes excess

3. **Item matching NO GD line (foreign item):**
   - Flagged as excess in `temp_excess_data` on the GD line that triggered the HU pick
   - To be resolved at pack station (return to stock, repack, etc.)

**Validation at confirm (applies to both FULL_HU_PICK and NO_SPLIT):**

- For each GD line, total picked qty across all selected HUs must not exceed `GD line qty * (1 + over_delivery_tolerance/100)`
- If exceeded → block confirm with error message
- This is the **only** place tolerance is checked — no per-HU qty filtering

**Auto-allocation Rules:**

- Selects whole HUs — never partially allocates from an HU
- Picks all items in the selected HU
- Auto-distributes items to matching GD lines (same as manual logic above)
- Caps fulfillment at each GD line's remaining qty
- Foreign items flagged as excess

**Data Structures:**

```javascript
// temp_excess_data (new) — stored on GD line that triggered the HU pick
[
  {
    handling_unit_id: "hu_123",
    handling_no: "HU-0001",
    material_id: "mat_456",
    material_name: "Item B",
    quantity: 50, // excess qty
    batch_id: "batch_789", // if applicable
    location_id: "loc_001",
    reason: "no_gd_line", // or "over_pick"
  },
];
```

**Cross-line auto-distribution flow:**

```
User opens Line 1 (Item A) dialog
  → Selects HU-001 containing: Item A (100), Item B (50), Item C (30)
  → Line 1 (Item A): allocate min(100, remaining_need_A) toward fulfillment
  → Line 2 (Item B): auto-populate temp data with min(50, remaining_need_B)
  → If Item C has GD Line 3: auto-populate Line 3
  → If Item C has NO GD line: add to temp_excess_data
  → User opens Line 2 dialog later: sees Item B already allocated from HU-001
```

---

### Shared Rules (FULL_HU_PICK and NO_SPLIT)

**Cross-line auto-distribution commits on dialog Confirm only:**
- Toggling an HU checkbox is a preview — cross-line data is NOT written until the user clicks Confirm
- Un-checking an HU before confirming cleanly rolls back with no side effects
- On Confirm: loop through all selected HUs' items, distribute to matching GD lines' `temp_qty_data`/`temp_hu_data`

**Already-allocated HUs are disabled in subsequent dialogs:**
- If HU-001 was confirmed/allocated from Line 1, it appears as **disabled** in Line 2's dialog
- Label: "Already allocated" — user cannot re-select the same HU from another line
- This prevents double-counting and simplifies the data model

**Auto-allocation uses same FIFO sorting as today:**
- HUs are sorted by the same FIFO/location logic used for loose stock
- No special "smallest HU first" optimization — keeps behavior consistent
- Auto-alloc picks whole HUs in FIFO order until GD line is fulfilled (or exceeded within tolerance)

**Loose stock behavior unchanged:**
- Split policy only governs HU picking behavior
- Loose stock tab and qty entry remain exactly as-is for all three policies

---

### 3. NO_SPLIT

**Intent:** Only pick HUs whose contents cleanly map to GD lines. No foreign items allowed. Multi-HU picks that combined exceed GD qty are handled as excess (same pattern as FULL_HU_PICK).

**HU Eligibility Check (evaluated per HU — determines enabled vs disabled):**

```
For each item in the HU:
  1. Find a GD line matching this material_id
  2. If NO matching GD line exists → DISABLE this HU (foreign item)
All items have matching GD lines → HU is ENABLED (selectable)
```

**Important:** Non-qualifying HUs are **shown but disabled** (all fields grayed out), NOT hidden. This lets users see why certain HUs can't be picked.

**Manual Dialog Rules:**

- All HUs are shown; non-qualifying ones are disabled with visual indication (e.g., grayed out, tooltip: "Contains items not in this delivery")
- Qualifying HUs use same UX as FULL_HU_PICK: checkbox on header, locked qty fields, pick entire HU
- User can select multiple qualifying HUs for the same GD line
- **Multi-HU excess:** If combined qty from selected HUs exceeds GD line need, the excess is tracked in `temp_excess_data` (same structure as FULL_HU_PICK, with reason: `"over_pick"`)
  - Example: GD needs 5 qty. User selects HU-01 (3 qty) + HU-02 (3 qty) = 6 total. 5 fulfills GD, 1 is excess.
- Tolerance validation at confirm: same rule as FULL_HU_PICK — total picked must not exceed `GD qty * (1 + tolerance/100)`
- Loose stock tab remains available as fallback when no qualifying HUs exist

**Auto-allocation Rules:**

- Only considers HUs passing the eligibility check (all items map to GD lines)
- Allocates whole HU
- Auto-distributes items to matching GD lines (same as FULL_HU_PICK)
- Tracks excess via `temp_excess_data` when combined allocations exceed GD line need

**Key difference from FULL_HU_PICK:** NO_SPLIT disables HUs with foreign items (items not in any GD line). FULL_HU_PICK allows them and flags the foreign items as excess.

---

## Comparison Matrix

| Feature                    |            ALLOW_SPLIT            |         FULL_HU_PICK         |         NO_SPLIT          |
| -------------------------- | :-------------------------------: | :--------------------------: | :-----------------------: |
| Partial pick from HU       |                Yes                |              No              |            No             |
| Foreign items in HU        | Ignored (pick only what you need) |  Allowed, flagged as excess  | HU disabled (shown but not selectable) |
| Excess handling             |               None                | Yes (temp_excess_data) | Yes (temp_excess_data for multi-HU over-pick) |
| HU filtering               |               None                |             None             |    Subset check (disable, not hide)    |
| User interaction           |      Enter qty per item row       |    Checkbox on HU header     |   Checkbox on HU header   |
| Auto-alloc partial HU      |                Yes                |              No              |            No             |
| Cross-line auto-distribute |                No                 |             Yes              |            Yes            |
| Loose stock available      |                Yes                |             Yes              |      Yes (fallback)       |

---

## Affected Files

### Must modify:

- **GDinventoryDialogWorkflow.js** — HU tab rendering, field locking, checkbox UX, filtering logic
- **GDconfirmDialog.js** — validation changes for whole-HU pick, excess data handling, tolerance cap
- **GLOBAL_AUTO_ALLOCATION.js** — the central auto-allocation engine. Currently injects HU items as virtual balance records (lines 52-78) and allocates partial qty via `allocateFromBalances`. Needs a new `splitPolicy` workflow param and logic to allocate whole HU quantities when policy is FULL_HU_PICK or NO_SPLIT (skip partial from HU balances, take full `item_quantity` per HU item)
- **GD_Backend_AutoAllocation_Workflow.json** (reference) — the backend workflow that orchestrates auto-allocation. Key nodes to modify:
  - `Global Allocation Params` (code_node_Htpcyp8t) — reads `pickingSetup`, builds huData per material. Needs to: (1) pass `splitPolicy` to GLOBAL_AUTO_ALLOCATION, (2) for FULL_HU_PICK, include ALL items in matching HUs (not just current material), (3) for NO_SPLIT, include all items but also pass GD line materials for eligibility filtering
  - `Run Global Allocation Workflow` (workflow_node_NwRLmxNW) — add `splitPolicy` to body_params
  - `process Allocation Result` (code_node_hifFKzmo) — handle cross-line distribution: when FULL_HU_PICK/NO_SPLIT returns allocations for other materials, update those rows' temp_qty_data/temp_hu_data in tableGD. Handle temp_excess_data for foreign/over-pick items
- **GDsaveWorkflowAllocationResult.js** — handle new `temp_excess_data` structure

- **GDProcessTable_batchProcess.js** — auto-release excess `on_reserved_gd` records at Completed; pass split_policy to dialog/allocation workflows

### Validation & SO selection (may need changes):

- **GDgdQtyValidation.js** — Per-row validation when user changes `gd_qty`. Currently computes `orderLimitBase` using `itemData.over_delivery_tolerance` (lines 112-149). For FULL_HU_PICK/NO_SPLIT, whole-HU picks can cause total picked qty > order qty. This validation needs to either: (a) be skipped/relaxed when split policy is active and allocation comes from whole-HU pick, or (b) validate against the tolerance only at dialog confirm time (as specced). Key: the tolerance comes from the **Item master**, not picking_setup.
- **GDgdQty.js** — Handles qty changes on GD lines. Lines 271-291: already skips auto-allocation when HUs exist for the material. For FULL_HU_PICK/NO_SPLIT, the `gd_qty` field represents the ordered/needed quantity (unchanged), while actual picked qty (from whole HU) lives in `temp_qty_data`. No major changes expected here, but should verify it doesn't clear `temp_qty_data` on qty change when whole-HU allocation exists.
- **GDaddBatchLineItem_OPTIMIZED.js** — SO line item selection into GD. `fetchPickingSetup` (lines 164-193) already fetches picking_setup but only extracts `pickingMode`, `defaultStrategy`, `fallbackStrategy` — needs to also extract `split_policy`. Lines 622-629: if material has HU, gd_qty field is not auto-enabled. This behavior may need adjustment: for FULL_HU_PICK/NO_SPLIT, gd_qty should still be filled with the order qty (SO's undelivered qty) since the user needs to see what they need to deliver, even though the actual allocation will be whole-HU.

### Must read (for context):

- **GDonMounted.js** — fetch picking_setup (add split_policy to fetched fields)

### New data:

- `picking_setup.split_policy` field (String, default "ALLOW_SPLIT")
- `temp_excess_data` JSON field on GD lines (for FULL_HU_PICK and NO_SPLIT excess tracking)

---

## Reservation & Excess Handling

### Reservation Rule (FULL_HU_PICK and NO_SPLIT)

When a whole HU is picked, **reserve the full HU quantity** in `on_reserved_gd`, not just the GD need.

Example: GD needs 10, HU has 15 → reserve 15 in `on_reserved_gd`.

### Excess Tracking

Excess is recorded in `temp_excess_data` on the GD line. This is a **data record only** — it does not trigger any workflow in this phase.

Excess reasons:
- `"over_pick"` — HU qty exceeds GD line need (applies to both policies)
- `"no_gd_line"` — foreign item with no matching GD line (FULL_HU_PICK only)

### At GD Completed

Any unresolved excess is **auto-released back to stock**:
- Reduce/delete the excess portion from `on_reserved_gd` records
- The excess qty returns to available inventory

### Future Scope (NOT in this implementation)

- Repacking workflow to handle excess at pack station
- Packing integration with `temp_excess_data`
- Return-to-stock workflow for excess items

---

## Verification Plan

1. **ALLOW_SPLIT:** Open inventory dialog → verify partial qty entry works exactly as today (regression test)
2. **FULL_HU_PICK manual:**
   - Set policy to FULL_HU_PICK
   - Open dialog for a GD line → verify qty fields are locked, checkbox appears on HU header
   - Select an HU with mixed items → verify all items picked, matching lines auto-populated, foreign items in excess
   - Open another line's dialog → verify it shows pre-allocated data from the HU pick
3. **FULL_HU_PICK auto:**
   - Trigger auto-allocation → verify whole HUs selected, no partial allocations, excess flagged
4. **NO_SPLIT manual:**
   - Set policy to NO_SPLIT
   - Open dialog → verify HUs with foreign items are shown but **disabled** (grayed out)
   - Verify qualifying HUs use checkbox UX
   - Select multiple HUs that combined exceed GD qty → verify excess tracked in `temp_excess_data`
   - Verify over-delivery tolerance is enforced
5. **NO_SPLIT auto:**
   - Trigger auto-allocation → verify only qualifying HUs are considered
6. **Fallback:** In NO_SPLIT, when no qualifying HUs exist → verify loose stock tab still works
7. **Reservation:** Verify full HU qty is reserved in `on_reserved_gd` (not just GD need)
8. **GD Completed with excess:** Verify excess portion is auto-released from `on_reserved_gd`
7. **Default:** New org with no split_policy set → verify ALLOW_SPLIT behavior (backward compat)
