# 2026-10-28 Create IA fills the IA form + plant-level login + Linked IAs / Create IA on the SO list's By Item tab

**Status: PASTED 21:09, verified 21:10** (`--after`). The IA form's `sc_main` and the SO Linked IAs page equal the pastes. The Sales
Order list v272 equals the paste plus the empty `onFormChange` entry the designer put back, which does nothing.

> **#4 DONE 21:13:** the empty unique group the designer added to the IA form (v37 `config.uniqueGroup` `[[]]`) is removed:
> prod v38 equals `4_IA_form_no_empty_unique_group.prod_paste.json` exactly (v36 + the new `sc_main`). Rollback for #3 / #4:
> paste `4_IA_form_v37.prod_base.json` / `1`-`3` `.prod_base` files.

**Built:**
- **Dev:** LIVE and tested by you (21:10): IA form v77, SO Linked IAs page v12, Sales Order list v543.
- **Prod:** checked 21:07: prod runs exactly the base each change was built on (IA form v36, SO Linked IAs v9, Sales Order list v271).
  So the paste brings only these changes.
- **Builder:** `python3 scratchpad/iasc/deploy/prod_folder_so_items.py --write` re-checks prod and rewrites this folder. Without
  `--write` it only checks; `--after` checks the paste once it's in.

## What users get
- **Create IA works on prod:** opened from an SO line, the IA form fills the item name, description and UOM. It also fills the
  planned output and quantity, and prepares the BOM components. Until now the form waited for a page parameter (`sc_entry`) that never
  reaches it, so on prod it opened with the item code only. For an organisation-level login the components table also opens unlocked.
- **Plant-level login:** Create IA makes the IA in the user's own plant, without Select Plant. Organisation-level logins are
  unchanged: the SO's plant, or Select Plant for an organisation-level SO.
- **SO list → By Item tab:** each line has **Linked IAs** and **Create IA**, the SO form's two line actions.
  - Same permissions (`so_item_linked_ias`, `so_item_create_ia`, already on prod), same rules: Create IA only on an open line of an
    Issued / Processing order.
  - An order being saved in the background isn't opened. The user gets View / Edit's message.

## Paste (3 targets, any order)
| # | File | Target on prod | Prod now → after |
|---|---|---|---|
| 1 | `1_SO_Linked_IAs_page.prod_paste.json` (the whole page) | page **SO Linked IAs** (id `2112449353901772801`) | v9 → dev v12 |
| 2 | `2_SO_list.prod_paste.json` (the whole page) | page **Sales Order** list (id `1901872125787099137`) | v271 → v271 + the two actions and their handlers |
| 3 | `3_IA_form_sc_main.js` (one handler) | form **Item Assembly** (`sm_item_assembly`, id `2098256587713404929`): replace the event script `sc_main` with this file; change nothing else | v36 → v36 + this handler (= dev v77's) |

- **#2, why a whole page:** row actions live in the By Item table's settings, not in a handler. The paste is prod v271 plus only the
  two row actions (after View / Edit) and the handlers `func_lineLinkedIas` / `func_lineCreateIa`. Everything else is v271 as it is,
  including `func_handleConvertGD` (the GD session's) and `onConfirm_selectPlant`.
- **#3, why one handler:** prod's `sc_main` is byte-for-byte the dev v76 handler the fix was built on. The paste changes 7 lines:
  - the SO-line entry no longer needs the page parameter;
  - it unlocks the components table when the plant comes with the IA.
  
  Nothing else in the form changes, so the transfer-request folder's IA form paste (`2026-10-28-ia-transfer-request`, still NOT READY)
  is unaffected. Its IA form file will carry this handler when it's refreshed.
- **After the paste:** tell me. I run `python3 scratchpad/iasc/deploy/prod_folder_so_items.py --after` (expect all IDENTICAL and the
  rest of each target unchanged), then `python3 scratchpad/prod_health.py`.
- **Rollback:** paste the two `.prod_base.json` pages back, and `3_IA_form_sc_main.prod_base.js` into the IA form's `sc_main`.

## Checks (21:07)
- **Prod bases:** IA form v36's `sc_main` equals dev v76's; SO Linked IAs v9 equals our base (= dev v9); Sales Order list v271 equals
  the pinned base.
- **The pastes are what dev runs:** `sc_main` equals dev v77's; the page equals dev v12 and the repo
  `Item Assembly & BOM/SmallCycle/SOLinkedIAsPage.json`; the list's two actions and two handlers equal dev v543's.
- **One empty field differs from dev:** each new list action is a copy of the page's own View action. Dev's View has an empty
  `dialog_top` that prod's lacks, so the prod copies lack it too. It does nothing.
- **Offline:**
  - IA form client suite all green (test_sc_link 89 incl. the new entry cases; sc_json 541; legacy 316; the rest), new mutants 3/3;
  - page 94/94, 50/50 mutants;
  - By Item actions 64 checks, 14/14 mutants;
  - plant warning 42.
