# Putaway attachments picked at confirmation were never saved

Photos and files attached when confirming a putaway as **Completed** were dropped. PUTAWAY_LOOP writes `ref_doc` only
on a non-Completed save (`update_node_YJRu1B3c`). On Completed it hands over to PUTAWAY, which writes only the status,
lines and records. The mobile app always confirms as Completed and sends the photos in `arrayData[].ref_doc`.

Prod, read-only:
- 10 confirmations carried a photo between 2026-09-17 and 2026-10-11 (tenants 073522, 496474, 605249);
- none of them was saved: 0 of 760 putaways in the last 60 days has an attachment.

**Prod status:** not pasted. The user deferred it to the next deployment (week of 2026-10-19). Prod PUTAWAY_LOOP is still
v15.

## Fix

Before PUTAWAY runs for an existing putaway (Edit), the files the confirmation carries are **added** to the putaway's
stored `ref_doc`, de-duplicated by url, link or key.
- An empty or absent list leaves the stored attachments alone. The released mobile app sends `[]` whenever no photo was
  taken, and never loads the stored list.
- A file can't be removed with a Completed confirmation; desktop removes attachments with a non-Completed save, as before.
- The write comes before PUTAWAY, so if it ever fails, no stock has moved.

New nodes, in the Completed branch of the loop:
- `code_node_PwRefDoc` decides whether to write;
- `if_PwRefDoc` → `sql_node_PwRefDocStored` (the stored list) → `code_node_PwRefDocMerge` → `update_node_PwRefDoc`.

## Files

- `PUTAWAY_LOOP.prod.json`: prod enabled v15 plus the fix. **Paste into prod PUTAWAY_LOOP.**
- `repair_ref_doc.sql` (optional, after the paste): puts the 10 lost photos back on their putaways.
  - The files are exactly as the confirmations sent them, taken from the run logs; the photos are still in file storage.
  - It only touches putaways that still have no attachment.
  - Run the `SELECT` in its header first.
- Builder: `scratchpad/pwv2/attach/patch_putaway_loop.py <deployed JSON> <out JSON>`. It asserts the Completed
  branch still has the v15 / v16 shape.

## Dev

Published 2026-10-16:
- PUTAWAY_LOOP v19.
  - v17 had the prop as a literal value, which stored the placeholder text.
  - v18 replaced the stored list, so the mobile app's `[]` would have wiped attachments (caught by the mobile session).
  - Both fixed the same morning.
- PUTAWAY_ASYNC_SUBMIT v5: the background completion saves `request.ref_doc` together with its lock.
- Putaway form v367: the desktop V2 button sends the attachment field.

Tested live:
- **TRF-PA-20261016-0009:**
  - the classic Completed save of line 1 with file A → saved, lock released;
  - then V2 for line 2 with files A + B → both saved at SUBMIT, job COMPLETED, putaway Completed, attachments kept.
- **TRF-PA-20261016-0008** (v19; also finishes the putaway the v17 failure had left In Progress):
  - classic Completed of 1 unit with A → [A];
  - with `[]`, as today's mobile sends → still [A];
  - with B only → [A, B];
  - V2 for the rest with no list → [A, B], job COMPLETED, putaway Completed, GR putaway Completed.

## Mobile

The released mobile app sends only the newly uploaded files, or `[]`. With this fix, the new photos are added to the
putaway's attachments and `[]` changes nothing. The mobile V2 work (`Putaway/AsyncV2/MOBILE_PUTAWAY_V2_GUIDE.md`) sends
the stored list plus the new files.
