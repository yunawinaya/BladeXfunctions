# SO_SAVE_COMMIT v7 review: working notes (2026-10-22)

Scope: SO_SAVE_COMMIT (id 2112758624899170305), dev v7. Read-only review. Simulation harness (library lines 1-514 of
code_node_SCa.js run in Node) lived in the session scratchpad; results quoted below.

## Shared bodies
- 11 step nodes (SCguard, SCgate, SCa, SCa2, SCa3, SCb, SCb2, SCb3, SCc, SCrel, SCdone): identical 515-line library
  (md5 prefix fb2ee5c534); only the last 3 lines (8 for SCrel) differ = the entry call.
- 11 result nodes (*res, *Sres): identical 469-line library (e9217c3ce6) = the step library minus the generated column
  lists / rules (lines 41-86). Copies agree. Builder `scripts/build-so-save-v2.mjs` is not in this repo.

## DB facts checked (dev)
- gd_publish_step UNIQUE (tenant_id, job_id, step_name); job_id/step_name varchar(32) (SOJ|/SOS|/SOP| keys fit).
- sales_order UNIQUE "Document Number" (so_no, organization_id); is_processing int exists.
- gd_async_job: every column COMMIT reads/writes exists.
- Every line column COMMIT writes exists. Header: delivery_method_text has no physical column (classic maps it too).
- Unmapped line columns so_tax_code_d_47yvq / atc_dtl_key: 0 of 37,308 dev lines filled. sub_tenant_* is
  stamped by the schema, not the payload.
- All sales_order date columns and line so_shipping_date are TIMESTAMP. Three V2 edits on dev kept so_date at midnight.
- dev @@time_zone SYSTEM (NOW() = MYT = create_time clock); prod @@time_zone UTC (NOW() 8 h behind create_time).

## Dev runs (28 SAVE_SO jobs)
- New 2,004-line SO (job 2113156489359720449): phase A 9.15 MB / 15.5 s (SCaparts resp 4.1 MB, SCa resp 3.2 MB);
  phase C 8.30 MB / 4.3 s (get_node_SCcso 3.37 MB, SCc soData echo 3.35 MB). Large inputs are not re-recorded in
  request_json_data. 2,004 lines written, distinct line_index, SO/20261022/088, unlocked.
- Never exercised on dev: an edit with more than 1 part (only S2|001 x6), any line delete, bundle children (no V2 SO
  has children), S5Q, more than 1 hold.
- Job 2113092886386786305: REQUIRES_REVIEW SOV2_NUMBER (old design, an update writing 'draft'); SO
  2113092901293342721 still so_no 'draft', unlocked by hand.
- GD edit 2112838980390039554: RELEASE step 10-21 17:30:48, finished 10-22 09:47:27 (GD Processing about 16 h,
  waiting for a client kick).

## Findings (see the final report for the ranking)
1. Edit S0N uses the stored rule and ignores a number the user changed (SCa.js 286-289; SPplan.js 677 drops
   so_no / so_no_type). The form allows it on a Draft. Simulated: Manual Input "ABC-1" leads to rule number need=YES;
   manual D-1 -> D-2 leads to need=NO.
2. New SO with a typed duplicate number: inserted under SOV2-<job>, then the S0N update hits UNIQUE(so_no, org).
   It crashes, retries 5 times, ends REQUIRES_REVIEW, and the SO is stuck with the temporary number. No duplicate
   check in SUBMIT or PREPARE.
3. S3 is not re-run safe: GD_EDIT_SUBMIT RELEASE answers NONE once a job is past HELD (ops.js:9). COMMIT treats
   anything other than RELEASED as REVIEW (SCrel.js:520, SCa.js 491-494). Simulated: REVIEW, the SO stays locked.
4. Hold expiry: holds are 900 s (ready.js:36, source CASCADE); COMMIT checks HELD only in S0, and S0 DONE is
   written before S1. Phase B is one 250-op part per worker call. An expiry before S3 leaves the SO saved and the GD
   not, with REVIEW.
5. Line before-images are never checked (PREPARE stores `before`, soCommitB ignores it; S0 checks header cells and
   the line-id set only). Whole-row writes include outstanding_quantity and line_status (GD-written per e4.js:5).
   GD_COMPLETE_SUBMIT v9, GD_CANCEL_SUBMIT v3 and GD_EDIT_SUBMIT v11 (live) have no SO is_processing / SAVE_SO
   check. Simulated: a stale line is overwritten silently.
6. Released GD edits wait for a client kick (evidence above).
7. Prod clock: draftSince = NOW() (SCjob:1) vs create_time (SCfind2:15). `already` (SCa.js:262) ignores lock_ref.
   The draft lookup also requires the job creator = the session user of the run.
8. S5 failures: 5 retries then REQUIRES_REVIEW blocks every later edit (SUBMIT BUSY "under review"). A retry can
   re-post or re-apply the reorder deltas in the window before each DONE row.
9. FORWARD SCrejres -> SCgate: real; benign (soCommitResult defaults gate to {}).
10. Contract: WORKER lease 300 s (brief 10 min); WORKER's retry exhaustion maps READY_TO_COMMIT to REQUIRES_REVIEW
    with no unlock or hold cancel (brief: FAILED before COMMITTING_SO).
