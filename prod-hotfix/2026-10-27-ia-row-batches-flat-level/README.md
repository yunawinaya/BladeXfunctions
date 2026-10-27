# 2026-10-27 Item Assembly form: one batch per split row + Flat BOM per place (EXPAND / STOP HERE) + "Stop at level"

**Status:**
- **Prod, pasted so far:** v67 at 20:52 (prod v34) and v68 at 21:14 (prod v35). Both verified IDENTICAL.
- **Prod, pasted 21:35 (prod v36), verified IDENTICAL 21:35:** `1_IA_form.prod_paste.json` is now dev **v69** (published 21:22). It has the BA's two
  fixes from "Flat BOM — Two Fixes Required":
  - **The same SFG on two lines of one BOM:** it now gets two rows, one per line, each with its own Expand / Stop here. The
    BA's check (line 1 Expand, line 2 Stop: RM-X 1 + SFG-X 2) passes.
    - The key gains a line number ("#n") only where an item sits on several lines, so every other key is unchanged.
    - IAs saved before keep their old meaning: an old key ticks both lines, as it did.
  - **Choices changed but the totals are the same:** Prepare BOM now saves the new choices in the snapshot and keeps the
    component lines and their stock picks as they were. It says so, instead of "The BOM has not changed".
- **Base of the next paste:** prod v35, re-checked 21:23; it is identical to dev v68.
- **Scope:** the IA form only. IA_SAVE and IA_V2_SUBMIT are unchanged, byte-identical to what dev and prod run.
- **v68's fixes, already on prod:**
  - Expand shows every immediate child, with raw materials as "Included".
  - A place whose BOM loops back isn't offered.
  - Preview errors pop up in full, and an empty BOM version shows "Default".
- **The Strap guide loop: FIXED on prod at 21:25.** The -02 BOM V1 was deactivated by the user. Re-scanned 21:36: 0 loops in
  710478, 946 of 947 BOMs active. Background: (4131-135200-02's BOM V1 of 26 October contains 4131-135200-07, whose BOM
  contains -02). The fix is to deactivate that V1 in the prod BOM screen once the BA or customer confirms. Until then, v68
  shows that place as "Included as it is".

## What users get
- **Split receipt, System-numbered batch items:** the **Group** column is gone, and every split row becomes its own batch.
  - Completing gives each row its own new batch number and its own dates.
  - Two rows into the same bin and category are fine now: they are different batches.
- **Split receipt, Manual batch items:** unchanged. You type the Batch No on each row; rows with the same number are one batch.
- **Flat BOM dialog (the BA's "choose where each BOM branch stops"):**
  - **Rows:** one row per place a component is used, in branch order (each row under the place above it), with its level and
    the BOM version that place uses. Raw materials, and sub-assemblies that can't be expanded, show as "Included" with no choice.
  - **Choosing:** tick a place to make it there from its own components (EXPAND); leave it unticked to take it from stock
    there (STOP HERE). The same item can be expanded in one place and taken from stock in another.
  - **What is shown:** at first only the level-1 SFGs. Expand shows that SFG's immediate children, each starting at Stop here
    so you choose again. Stop here hides and clears everything under it.
  - **Assembly components:** a table under the choices shows the resulting component list with the required quantities. It is
    refreshed on every choice, with the same BOM, base-quantity and UOM rules the save uses.
  - **Stop at level (1-6):** ticks every place above that level; single places can be changed afterwards. Expand All is still
    there.
  - **Older IAs:** an IA prepared before (item ticks) reopens with the same result as before.

## Paste (user)
1. **Before:** `.dbtools/form --prod status sm_item_assembly prod-hotfix/2026-10-27-ia-row-batches-flat-level/1_IA_form.prod_v35_base.json`
   must say IDENTICAL. If it doesn't, someone changed the form on prod after 21:23. Stop and tell me: the paste would wipe their
   change.
2. **Paste:** table **Item Assembly** (`sm_item_assembly`, id **`2098256587713404929`**), file `1_IA_form.prod_paste.json`. Not Item
   Disassembly (`2106937624568991746`), not the Item Assembly history table.
3. **After:** `.dbtools/form --prod status sm_item_assembly prod-hotfix/2026-10-27-ia-row-batches-flat-level/1_IA_form.prod_paste.json`
   says IDENTICAL. Users with the IA form open get it when they reload.

**After the paste I run read-only checks:** the form IDENTICAL, the new columns there, `python3 scratchpad/prod_health.py`.

## Rollback
Paste `1_IA_form.prod_v35_base.json` (the v68 pasted at 21:14) back into the same table. Earlier states: `1_IA_form.prod_v34_base.json`
(v67) and `1_IA_form.prod_v33_base.json` (before tonight's form changes). The new column stays; nothing reads it. A Flat IA prepared with
v66 keeps its result. The old dialog shows it with item ticks.

## Notes
- **New columns:** the publish adds two columns to `sm_item_assembly`, the same way the dialog's table got `sc_expand_table`. No
  save ever writes them.
  - `sc_expand_level` (varchar): the Stop at level choice.
  - `sc_expand_preview` (json): the Assembly components preview.
- **Saved data:** prod has no split IA and no Flat IA yet (checked 20:00 / 20:33).
  - A Draft saved with split rows sharing a group would be renumbered to one batch per row when it is opened.
- **Open tabs:** a user who keeps the old form open until they reload keeps the old behaviour (Group shown, item ticks). The
  save still accepts it.
- **Mobile:** unchanged. It doesn't send split rows or prepare Flat (`MOBILE_RES01_GUIDE.md`, section 8b, notes the per-row rule).

## Tests (offline)
- **Form:**
  - Split form test: 57 checks.
  - Flat dialog test: 99 checks. They cover the BA's cases (an item kept at one place and expanded at another; duplicate lines;
    choices moved with the same totals), hidden children and choosing again, the included rows, a BOM loop, the live preview's
    quantities and warning, saved places, older IAs' item ticks and plain keys, Stop at level and Clone.
  - Form structure: 469 checks. The Small Cycle suite is green.
- **Resolver:** 94 checks, 33 of 33 mutants killed. They cover per place, duplicate lines, older snapshots, a loop in the BOMs
  and branch order.
- **Server pin:** a test pins that the copy the server embeds matches the current code in every function except the resolver.
- **Server, unchanged but now used one batch per row:** a 20-row System split with 20 groups passes in the classic save
  simulation and in the background SUBMIT simulation.
- **Full form mutation run (v69):** clean at 21:34. All 277 form mutants are killed: 273 in the full run, plus 4 stale anchors
  re-anchored and killed on their own.
