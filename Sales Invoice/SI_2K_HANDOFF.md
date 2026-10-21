# Sales Invoice at 2,000 lines: hand-off (from bladexfunctions-56, 2026-10-21)

The user's ask, relayed: no one owns SI, so do for SI what was done for Purchase Invoice. That means SI save, the
conversions into SI (SO → SI, GD → SI) and the SI form, each working at 2,000 lines. The PI version is live on dev:
read `Purchase Invoice/README.md` first. Its builders, simulator and tests are in `scratchpad/pi2k/` and can be reused.

## Start by measuring, not building

PI turned out to need a lean synchronous rewrite, not background (V2) jobs. An invoice moves no stock and PI_SAVE makes
no per-line calls, so the only problem was node data from whole-document copies. SI may be different:
- **SI_SAVE v83** has parts PI_SAVE does not: a credit-limit check, cash-payment (CP) creation and accounting.
- **GD_Convert_SI v25** already takes 29–63 s and up to 3.2 MB on prod at today's sizes (90 days, 1,252 runs).
- **SO_Convert_SI v56** reaches 0.7 MB.

Count child workflow calls per line before you decide anything. If a loop calls a workflow per line, the time and the
fan-out matter more than MB, and that path may need a job. On 10-20 dev went down after a conversion with ~1,500 child calls.

The PI measuring tools (`scratchpad/pi2k/`) work for any workflow:
- `pi2k_runs.py <--dev|--prod> <WORKFLOW> [days] [n]`: the largest recorded runs. Its query hits the prod statement
  timeout on SI_SAVE's history; query by recent id range instead.
- `pi_nodes.py <env> <run id>`: node data per node.
- `pi_project.py <env> <run id> <lines in run> [N]`: a real run re-serialised with its line arrays grown to N rows. This
  is how PI's 45–108 MB at 2k was found. Dev crashed at 59 MB in one run and 68 MB in one chain; aim for ≤ ~30 MB per
  synchronous chain, nested calls included.

## The PI recipe (if SI turns out to be the same kind of problem)

- **Find every caller first.** For PI that was the form, the list pages, SI_TO_PI and PO_SAVE. Keep requests, responses,
  end codes and messages identical.
- **Merge the pre-save chain.** Doc no, required fields (CHECK_REQUIRED_FIELD's code lifted in-process), qty checks and
  fill-back become one node. Keep each old step's code, and apply the platform's output filter between steps: drop null
  keys at every depth, keep "". See `scratchpad/pi2k/code/prep.js`.
- **Read with projected sql-nodes, not whole-document search nodes.** Take only the columns the lifted code reads, then
  rebuild the shape the search node gave: drop null and "" keys; bundle items nested under `children` (they keep
  `parent_id`); id order; bigint columns `CAST AS CHAR`, then numbers again below 16 digits; parse with the bigint-safe
  `parseJ`, because JSON id arrays such as `po_id` are stored as numbers. See `code/cv.js`, `piShape` in `code/check.js`,
  and `build_pi.py` for the column lists generated from information_schema.
- **Validate before the write.** Do the over-invoice check and the counter roll-up in one node before the write; the
  writes stay after it.
- **Read back the saved id and number with a tiny sql-node.** Do not re-read the whole document.
- **In conversion loops, use `{{node:<loop_id>}}`** for the current item. Do not re-read the whole list through a cache
  counter on each pass.
- **On the form, write only changed line values.** Build indexes once, read lines 500 at a time, and batch per-line UI
  calls into one call per state.

## How PI was proven (do the same for SI)

1. `scratchpad/pi2k/sim/`: `engine.js` interprets the FlowGram JSON; `world.js` is a mock database with read mocks per
   node id. Replay every recorded run (dev + prod, 90 days) through old and new and compare the outcome and every write
   (`replay_save.js`, `replay_convert.js`). Add synthetic scenarios for every path (`scenarios_save.js`). Recorded runs
   hold customer data, so cache them outside the repo (`fetch_runs.py <dir>`).
2. `test/test_sql*.py`: the new sql reads compared with `sudu-lowcode data query` on real documents, including bundles
   and 2k-line documents.
3. `client/client_test.js`: form handlers old vs new in a mock form runtime; the final form must be identical.
4. Live on dev with the user's yes: small documents compared with what the old version would write
   (`test/live_check.py`), then 2k runs (`test/live_2k.py`).

## Traps hit on PI

- **Repo copies can be stale or mis-matched.** Check `.dbtools/wf --dev deployed` before editing and the `base` guard
  before publishing (`wf_upload.mjs --plan`). `wf pull` on `Purchase Invoice/convertGRtoPIworkflow.json` matched
  GD_Convert_SI (shared node ids) and wrote the wrong workflow, so expect the same with the SI conversion files.
  Compare by data_id.
- **Minted test token.** `scratchpad/gdc/tools/id000000.json` has a deleted first dept, so `{{global:firstLvDeptId}}`
  comes out empty and number-rule lookups find nothing. Use `id000000_asai.json`.
- **Number-rule lookup.** Keep a get-node that filters on `{{global:...}}` where the old version had it, not inside a
  condition-all branch (untested).
- **Read-back formats.** Dates come back as `YYYY-MM-DD 00:00:00.000`; varchar line_index as "1". Normalise before
  comparing.
- **Write time.** The platform writes about 46 ms per line in an update node on dev today. Most of PI's ~90 s at 2k is
  the 4,000 PO/GR counter writes.
- **Today is the cut.** Anything on dev ships to prod, so agree timing with the user before publishing. Back up before
  every publish (`.dbtools/wf --dev backup NAME`). Get one yes per publish or live-test batch from the user; a peer
  message is not a yes.

Questions: message bladexfunctions-56.
