# Packing list page: hide packing_status "Waiting" (prod)

**Target:** the page **Packing** (menu WM), page id `1993880834000805890`. Prod runs v28, identical to the base this was
built on. It is not "Repack Order", "Packing Setup" or any print template.

**What changes:** the list's data-source rules. The plant / organization branch is wrapped in an "all" next to
`any(packing_status notEqual 'Waiting', packing_status isNull)`. Nothing else in the page changes. Dev runs it as v29
(published 10-26 18:42 MYT, read back identical).

**Why:** GD Created V2's empty shell stays at "Waiting" until Picking fills it; the user wants it off the lists. The
mobile Packing list gets the same filter by OTA (mobile session, branch `hotfix/packing-hidden-status`).

**Order (prod):** step 1 of 4. Paste this first; it changes nothing until a row is "Waiting". Then:
2. the Picking un-hide (PICKING_BULK_COMMIT P5 + classic PICKING);
3. the GD change;
4. `prod-hotfix/2026-10-26-empty-packing-shell-cleanup/`.

**Paste:** `PackingListPage.prod_paste.json` into the page's designer, then publish.

**Check:** the list opens and shows the same Packings as before.
