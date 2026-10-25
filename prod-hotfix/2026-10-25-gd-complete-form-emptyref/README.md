# GD Completion V2 from the GD form never ran on prod: an empty attachment counted as an edit (2026-10-25)

## What was wrong

The GD form's Completed button asks GD_COMPLETE_SUBMIT first (source FORM). SUBMIT compares the form with the stored GD; any
difference means "unsaved changes", and the completion goes to the classic save instead.

The form sends `gd_ref_doc: []` (no attachments). A GD that never had an attachment stores `null`, and the check counted that
as an edit. Since 10-20, every one of the ~240 form completions on prod went to the classic save, in every tenant: LSH 21 of 25
(the rest were BUSY), 035843 60, 073522 43, 681409 29, 528521 19, 900938 16, ... The V2 completion ran only from the GD list
(LSH 360).

For LSH this matters beyond speed. A classic completion writes stock without the V2 stock locks, the writer behind
GD-2610-1245's lost 5 units (`prod-hotfix/2026-10-25-lsh-gd1245-balance/`). Once mobile Packing is V2, these form completions
are the main classic writer left on LSH's GD path.

## Fix (GD_COMPLETE_SUBMIT, node `code_node_GSgate` only)

`gsFormDiff` (source `scratchpad/gdc/code/submit/gate.js`) now treats an empty list or object, `[]` / `{}` as a value or as
text, the same as `null`. A real attachment, or any other edited field, is still an edit and still goes to the classic save.

## Evidence

- `scratchpad/gdc/test/test_submit_force.js` has a new case for this: 7 of 7 pass, and the new case fails on the old code.
  `test_client_force.js` 9, `test_hu.js` 10 and `test_list_mounted.js` 6 also pass.
- `submit_sim.js` runs the built workflow on dev reads (read-only):
  - old build, form = stored GD + `gd_ref_doc: []`: NOT_ELIGIBLE "unsaved changes (gd_ref_doc)";
  - new build, same form: GO, then QUEUED on packed GDs (496474 GD/20261021/092, 073, 074, GD/20260910/043);
  - new build, an edited remark: still NOT_ELIGIBLE.
- Prod's form handler `gdc_onClick_save_as_completed` equals the repo file. Its QUEUED branch shows "being completed in the
  background", closes the dialog and starts GD_COMPLETE_WORKER with the job id. `client_form_sim.js` covers it.
- Lint unchanged. The paste file is prod v11 (= dev v12, same hash) with that one node changed.

## Prod

1. Paste `GD_COMPLETE_SUBMIT.prod_v11_emptyref.json` into **GD_COMPLETE_SUBMIT** (id 2110182609618337794). Not
   GD_COMPLETE_WORKER, not GD_CANCEL_SUBMIT.
2. Check: `.dbtools/wf --prod deployed prod-hotfix/2026-10-25-gd-complete-form-emptyref/GD_COMPLETE_SUBMIT.prod_v11_emptyref.json`
   must say IDENTICAL.

`GD_COMPLETE_SUBMIT.prod_v11_live.json` is what prod runs now, kept to reverse the change.
