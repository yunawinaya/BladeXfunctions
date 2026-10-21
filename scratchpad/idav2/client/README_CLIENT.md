# Item Disassembly V2 - the client (package D; section for the controller to merge into `Item Disassembly/AsyncV2/README.md`)

Built by `scratchpad/idav2/client/build_client.py` from the live dev form v35 (`base/ida_form_v35.json`, md5 `86100240...`) and
the list's current dev row, zhenxiang's designing v17 (`base/ida_list_v17d.json`, md5 `0f244e67...` = enabled v16 + two designer
defaults; wf_upload's base guard compares against it); the build stops if either base changed. Paste / publish files:
`Item Disassembly/AsyncV2/IDAform.json`, `IDAlistPage.json`; every new or changed script is mirrored next to them
(`idaV2_*.js`, `idaForm_*.js`, `idaList_*.js`). Regression: `node scratchpad/idav2/client/check_all.js`.

## Switches (constants in the scripts; rebuilt, never hand-edited)
| Switch | Where | OFF |
|---|---|---|
| `ASYNC_IDA_ENABLED` + `IDA_V2_ACTIONS { COMPLETE, COMPLETE_POST }` | Completed / Complete & Post buttons, form mounted (`IDA_BG_ENABLED`), list kick | every click runs the classic handler, byte-identical; no V2 call, no browser storage |

`python3 build_client.py --write` builds OFF (the first publish) and an ON preview in `client/out/on/`.
`--on[=COMPLETE,COMPLETE_POST] --write` writes that ON build to the repo and is refused while `ids.json` holds "0" for
IDA_V2_SUBMIT / IDA_V2_WORKER (nothing written). At run time a click stays classic unless the switch, its action and both ids
are set. Rollback without a rebuild: bind `button_completed` back to `onClick_saveAsCompleted` (key `iasvcomp`) and
`comp_post_button` to `onClick_saveAsCompletedPost` (`aymq6q8z`).

## What the client does
- Completed / Complete & Post: V2 (IDA_V2_SUBMIT) when the switch and action are on, the page is Add / Clone or an Edit of a
  stored Draft, more than 50 moves (source picks with `sm_quantity > 0` + recovery lines with an item), no handling unit
  (a pick's `handling_unit_id`, `temp_hu_data`, `table_hu`) and no serial-numbered pick; anything else, a NOT_ELIGIBLE /
  INVALID answer or an error before SUBMIT -> the classic handler (once). IDA's own `validateForSave` (it lets the stock
  dialog's rules and Batch No's asterisk through) and the BOM-variance confirm run first, both verbatim from the classic.
- The idempotency key `IDA:<org>:<id | new-<page token>>:<hash16>:<gen>` covers the record minus the form's own keys
  (badges, buttons, layout, the stock dialog, `item_display_table`, `ida_source_stock_mode`, `ida_v2_job_id`, `ida_idem_key`,
  `dialog_*`); both buttons send the same key; a FAILED job moves to the next generation. A click claims `ida_submitting` before
  its first await (a second click is refused) and every exit releases it. A lost answer, STOP 500, the
  platform's error envelope or an unlinked Add keeps the key for the next click (and hides Save as Draft on an Add).
- The verdict: COMPLETED, or (no post) COMMITTING_IDA at 80 % (both legs moved) -> the form closes and the worker is kicked
  up to 10 more times. Complete & Post posts with the classic `postToAccounting` code, verbatim, only on COMPLETED (never on
  an "already completed" STATUS answer), once per job: this browser's `localStorage ida_v2_posted_<jobId>` mark, then the stored
  status / posted_status (Completed + Unposted / Failed Post / blank) - a second tab or browser on the same Draft follows the same job; if the 420 s wait ends first: "Still completing in the background; post it from the
  list once it shows Completed." With `COMPLETE_POST` off (and `COMPLETE` on) a big Complete & Post completes in the
  background and is posted from the list.
- A Processing IDA opens read-only (Processing badge, header and components locked, no save / post button, a message). With
  the switch on it follows the job (STATUS every 3 s, a worker kick every 15 s, 420 s). A failed job is shown once per
  browser (`localStorage ida_v2_failed_seen_<jobId>`).
- Post (the form's Post and the list's bulk Post) re-reads the stored status and writes Pending Post only for a Completed
  disassembly that is Unposted / Failed Post / blank; a stale form or grid row is refused / named in a warning.
- List: the first `mounted` kicks IDA_V2_WORKER (on its switch and id, at most every 2 minutes per browser, chained while
  `processed > 0`, at most 40 rounds); Edit is hidden for a Processing row; Delete refuses Processing (and re-reads the stored
  status after the confirm).
- 2,000 lines (whatever the switch): the BOM explode reads Items with `.field()` (only the 9 columns it reads, which also
  prunes the Item subform joins), in 500-id chunks with `.limit(<chunk>)`, re-asking for the ids a clamped answer left out;
  its UOM / default storage / default bin / source balance / HU reads carry explicit limits. Its per-row option / disabled
  loop, the Batch Add and item-picker handlers and mounted's per-row loops are unchanged (measured: `client/out/measure.txt`).

## Limits
- **Posting** (user decision 2, unchanged fetches): SQL_FETCH_POST_DATA v225 / ATC_FETCH_POST_DATA v146 refuse more than
  1,000 distinct item / UOM / plant / project / bin / batch ids ("Too many reference IDs; split the task"): an IDA above
  ~1,000 recovery items cannot be posted. They also refuse a recovery `batch_number` of `-` or `Auto-generated batch number`
  ("not resolved by the save workflow"): an IDA with a non-batch recovery line cannot be posted on either path (flag F1).
- At 2,000 lines the per-row `disabled` / `setOptionData` calls stay as the base makes them (explode 6,001 disabled paths,
  Batch Add of 2,000 items 12,000, opening a 2,000-line Draft 5,999); GR's finding (the runtime copies its state map per
  path, 14k paths ~21 s) suggests a freeze of seconds there - to be timed in the browser (plan verification 10).
- Mobile still uses the classic save (the guarded classic refuses Processing).
