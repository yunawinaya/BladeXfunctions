# 2026-10-28 Create IA from an SO line + the Convert to GD plant warning

**Status:**
- **Dev:** LIVE since 20:05 (SO Linked IAs page v9, Sales Order list v541). You tested both on dev.
- **Prod:** not pasted. Checked 20:22: prod runs exactly the base each change was built on (SO Linked IAs v8, Sales Order list
  v270), so the paste brings only today's work.
- **Builder:** `python3 scratchpad/iasc/deploy/prod_folder_so.py --write` re-checks prod and rewrites this folder; without
  `--write` it only checks.

## What users get
- **SO line → Create IA:**
  - the Item Assembly form opens on the right, like every other form (Open in the linked-IA list too);
  - an organisation-level Sales Order asks for the plant first (**Select Plant**, as Convert to GD does);
  - an item with no active BOM can't start an IA: Create IA is hidden, and the reason is shown.
- **SO list → Convert to GD:** a selected SO may have an Item Assembly (not cancelled) or a Pending production reservation in
  another plant than the one chosen. If so, one **Another plant** warning names them:
  - **Continue** converts as before;
  - **Cancel** keeps the Select Plant dialog open.
  
  When nothing is in another plant, or a check can't be read, it converts as before without asking.

## Paste (2 targets, either order, before 22:00)
| # | File | Target on prod | Prod now → after |
|---|---|---|---|
| 1 | `1_SO_Linked_IAs_page.prod_paste.json` (the whole page) | page **SO Linked IAs** (id `2112449353901772801`) | v8 → dev v9 |
| 2 | `2_SO_list_onConfirm_selectPlant.js` (one handler) | page **Sales Order** list (id `1901872125787099137`): replace the event script `onConfirm_selectPlant` with this file; change nothing else | v270 → v270 + this handler (= dev v541's) |

- **Not touched:** the IA form, any workflow, and the transfer-request folder (`2026-10-28-ia-transfer-request`, still NOT
  READY). This paste doesn't depend on that folder.
- **After the paste:** tell me. I run `python3 scratchpad/iasc/deploy/prod_folder_so.py --after` and expect the page IDENTICAL
  and the handler IDENTICAL, with everything else as v270. Then I run `python3 scratchpad/prod_health.py`.
- **Rollback:** paste `1_SO_Linked_IAs_page.prod_base.json` back, and put `2_SO_list_onConfirm_selectPlant.prod_base.js` back
  into the handler.

## Checks (20:22)
- **Prod bases:** SO Linked IAs v8 equals dev v8, our base. Sales Order list v270 equals the pinned base (md5 `fb72408a…`).
- **The pastes are what dev runs:** the page equals dev v9 and the repo `Item Assembly & BOM/SmallCycle/SOLinkedIAsPage.json`.
  The handler equals dev v541's.
- **Handler-only:** the SO list paste changes only `onConfirm_selectPlant`. `func_handleConvertGD` (the GD session's) is
  identical on prod, dev and the paste.
- **No dev-only ids:** the page's one new id is the org-structure datasource (`blade_dept`, `1789995126399348747`). It exists
  on prod, and the prod IA form already uses it.
- **The prod IA form (v36) needs nothing:** its Small Cycle handler `sc_main`, which reads the plant the page passes, is
  identical to dev v76.
- **Offline:** SO Linked IAs page 91/91 with 47/47 mutants killed; plant warning 42 checks with 10/10 mutants killed.

## Not tested
- **A plant-level login:** for a new IA, the IA form's own rule (`setPlant` in mounted) sets the plant to the user's own plant.
  So a plant-level user who picks another plant in Select Plant may still get their own plant. This was the same before
  today's change.
