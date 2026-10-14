# Packing V2 dev test tools

DEV only. They pack a Packing's lines into HUs without the form, so a large completion can be tested from the terminal.
Every workflow runs as a real user of the Packing's tenant, through the project skill `running-dev-workflows-as-tenant`
(`scratchpad/gdc/tools/runas.mjs`, identity files `id<tenant>.json`). Each step writes dev data, so get a yes first.

| File | What |
|---|---|
| `PKG_TEST_ADD_HU_ROWS.json` | Workflow (dev 2110203761799593985). Inserts completed HU rows into a Created Packing that has none: the rows the form's bulk completion writes through its client data API. Refuses anything else. |
| `autopack.py` | `plan`: splits the Packing's source rows into N HUs, writing one REPACKING_PROCESS request per HU (as `PackingTableHUCompleted` sends it) and its `temp_data` (as `PackingBulkPickItems` builds it). `rows`: from the REPACKING answers, writes the `PKG_TEST_ADD_HU_ROWS` and `PACKING_ASYNC_SUBMIT` requests. |
| `snap.py` | Read-only snapshot of everything a Packing completion can write (Packing, GD, SO, reservations, balances, HUs, movements, job, steps, operation), and a diff of two snapshots. |

## A run (2026-10-14: PACK/20261012/0027, 2,000 lines, tenant 496474)

```
python3 snap.py take p0027_before PACK/20261012/0027 496474
python3 autopack.py plan PACK/20261012/0027 496474 4 <hu bin id> <hu storage location id> <dir>
node scratchpad/gdc/tools/runas.mjs scratchpad/gdc/tools/id496474.json 2043602532898443266 <dir>/repack_1.json <dir>/repack_out_1.json   # REPACKING_PROCESS, one HU at a time
python3 autopack.py rows <dir>
node scratchpad/gdc/tools/runas.mjs scratchpad/gdc/tools/id496474.json 2110203761799593985 <dir>/addhu.json <dir>/addhu_out.json        # PKG_TEST_ADD_HU_ROWS
node scratchpad/gdc/tools/runas.mjs scratchpad/gdc/tools/id496474.json 2109924558618333185 <dir>/submit.json <dir>/submit_out.json      # SUBMIT
node scratchpad/gdc/tools/runas.mjs scratchpad/gdc/tools/id496474.json 2109924593737240578 <worker.json: {"job_id": ...}> <out>          # WORKER
python3 snap.py take p0027_after PACK/20261012/0027 496474
```

What it skips: the form's own steps (bulk pick, the HU completion handler, the Completed handler). A browser pass on a
small Packing covers those.

Batch items: `autopack.py` reads the balance row the way the form does (`item_batch_balance` for a batch, else
`item_balance`). Batch run 2026-10-14: PACK/20260930/0040 (tenant 000000), 2 batches into 2 HUs at LB-01.
