# Item Assembly V2 - the client (package D; section for the controller to merge into `Item Assembly & BOM/AsyncV2/README.md`)

Built by `scratchpad/iav2/client/build_client.py` from the live dev form v34 (`base/ia_form_v34.json`, incl. the dev admin's
v33 / v34 edits) and list v20
(`base/ia_list_v20.json`). Paste files: `Item Assembly & BOM/AsyncV2/IAform.json`, `IAlistPage.json`; every new or changed
script is mirrored next to them (`iaV2_*.js`, `iaForm_*.js`, `iaList_*.js`). Regression: `node scratchpad/iav2/client/check_all.js`.

## Switches (constants in the scripts; rebuilt, never hand-edited)
| Switch | Where | OFF |
|---|---|---|
| `ASYNC_IA_ENABLED` + `IA_V2_ACTIONS { COMPLETE, COMPLETE_POST }` | Completed / Complete & Post buttons, form mounted, list kick | every click runs the classic handler, byte-identical |
| `ASYNC_IA_REVERT_ENABLED` | list Revert Completed, list kick, form mounted (revert jobs) | every IA takes the classic IA_REVERT |

`python3 build_client.py --write` builds OFF (the first publish). `--on[=COMPLETE,COMPLETE_POST,REVERT] --write` builds ON and
refuses while `ids.json` holds "0" for a workflow; COMPLETE / COMPLETE_POST are refused without REVERT (CONTRACT ruling 9), and
at run time a completion click stays classic unless Revert V2 (its switch and ids) is on too. Rollback without a rebuild: bind `button_completed` back to
`onClick_saveAsCompleted` (key `iasvcomp`) and `comp_post_button` to `onClick_saveAsCompletedPost` (`aymq6q8z`).

## What the client does
- Completed / Complete & Post: V2 (IA_V2_SUBMIT) when the switch and action are on, the page is Add / Clone or an Edit of a
  stored Draft, more than 50 picks (`temp_qty_data` entries with `sm_quantity > 0`), no handling unit, no serial number;
  anything else -> the classic handler (once). The classic's `this.validate()` and BOM-variance confirm run first.
- Complete & Post posts with the classic `postToAccounting` code, verbatim, only once the job is COMPLETED; if the 180 s wait
  ends first: "Still completing in the background; post it from the list once it shows Completed." With `COMPLETE_POST` off
  (and `COMPLETE` on) a big Complete & Post completes in the background and is posted from the list.
- A Processing IA opens read-only (badge, no save / post button, components locked); with a switch on it follows the job
  (STATUS, worker kick every 15 s: the completion or the revert worker by the job's action). A failed job is shown once per
  browser (`localStorage ia_v2_failed_seen_<jobId>`).
- Post (the form's Post and the list's bulk Post) re-reads the stored status and writes Pending Post only for a Completed
  assembly that is Unposted / Failed Post / blank; a stale form or grid row is refused (review R3).
- List: the first `mounted` kicks IA_V2_WORKER and IA_REVERT_V2_WORKER (each on its switch, at most every 2 minutes per
  browser); Edit is hidden and Delete refused for a Processing IA (Delete re-reads the stored status first); Revert Completed
  sends each IA to IA_REVERT_V2_SUBMIT (`min_picks` 50): 50 live rows or fewer, NOT_ELIGIBLE, INVALID or no usable answer
  -> the classic IA_REVERT call for that IA, unchanged.
- Labour / overhead (whatever the switches): a non-stock (`stock_control` 0) component carries `total_quantity` = its BOM
  quantity (or the typed one), no picks, no auto-allocation, no Transfer Stock (the link is disabled; opening the dialog on
  one closes it with a message). Every explode / allocate read has an explicit `.limit()`, 500-id chunks and a re-read when
  the API clamps it (5,000 rows).

## Limits
- **Posting:** the posting fetch (SQL_FETCH_POST_DATA, dev v220 / v221) refuses more than 1,000 distinct item ids, the parent
  included ("Too many reference IDs; split task"): an IA above ~1,000 components cannot be posted (830 is fine). It also
  needs `total_quantity > 0` on every line (non-stock lines carry their quantity).
- Mobile still uses the classic save; its client-side delete must refuse Processing.
