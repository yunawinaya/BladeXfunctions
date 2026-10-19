# scratchpad/smv2/lib - copied V2 tooling (WP0, 2026-10-16)

COPIES, never imports, of the generic pieces of the deployed V2 builders (other sessions own the sources: never edit
scratchpad/gdc, grv2, pwv2, grrv, gde). `python3 test/lib_smoke.py` checks every copy against its source (16 checks).

| File | Copied from | Changed |
|---|---|---|
| `wfkit.py` | scratchpad/grv2/wfkit.py | `js(path)` reads `scratchpad/smv2/code/<path>` (new `ROOT`); docstring. Node shapes, key RNG (seed 20261012) unchanged |
| `dbq.py` | scratchpad/grv2/dbq.py | none (`q(env, sql)` through the read-only `.dbtools/db`) |
| `fmt.py` | scratchpad/grv2/fmt.py | none (Prettier from `~/.npm/_npx/b388654678d519d9`) |
| `outline.py` | scratchpad/grv2/outline.py | none |
| `v2build.py` | scratchpad/grv2/build_grv2.py | the generic part only: constants `JOB STEP IT ITEM ENGINE TOKENS JOB_PROPS STEP_PROPS RES_FIELDS IT_COLS JOB_ADD_COLS PART_COLS`, helpers `N raw is_ gate call job_update step_add sub wrap_sql wrap_doc_sql`, and `build_worker(cfg)` = `build_grv2.build_worker()` with every GR global (lock join, id / prev columns, command, states, callee ids, unlock node, worker JS folder, cache key, correlation offset of the final read, post-build renames) taken from `cfg` (`worker_config()`). Added: `status_unlock(table, column, labels)` (= `gr_unlock` with the table explicit), `include_js(root, path)` (a code/shared file minus its `if (typeof module` export line - gdc/build_ts.py's rule), `slice_loop` / `step_done` with the node prefix explicit, `build(builders, out, write, want)` (the build_grv2 `__main__` loop), and `gr_worker_config()` / `pw_worker_config()`, which rebuild GR_COMPLETE_WORKER / PUTAWAY_ASYNC_WORKER byte-for-byte (smoke test) |
| `lift/lift.py` | scratchpad/pwv2/lift/lift.py | SOURCES / OUT / header are a JSON config (`python3 lift.py <config.json> [--check]`) or `build(sources, header, rel_root)` arguments; a missing node id is a KeyError; grv2's "no `{{` left" assertion is back. `nodes_by_id`, `rewrite`, `lift` unchanged (smoke: identical output on Putaway's sources) |
| `lift/runtime.js` | scratchpad/pwv2/lift/runtime.js | none |
| `sim/engine.js`, `sim/db.js`, `sim/test_flow.js` | scratchpad/gdc/pkv2tools/sim/ | none. `engine.js` is the generic FlowGram interpreter (code / sql / get / search / add / update / if / condition-or / condition-all / loop / cache / workflow / return nodes; mocks per node id). `db.js` + `test_flow.js` are the Picking V2 example: their mocks predate today's Picking JSON, so `test_flow.js` stops at "no SQL mock for sql_node_PSmove" - exactly as the original does |
| `harness.js` | scratchpad/gdc/pkv2tools/harness.js | `sim/test_flow.js` requires it as `../harness`; its `run(file)` code root is `scratchpad/smv2/code` |
| `sqlcheck.py` | scratchpad/grv2/sqlcheck_grv2.py | the generic runner: `python3 sqlcheck.py <dir> <values.json> [NAME ...]`, values `{"*": {...}, "<NAME>": {...}, "missing_cols": {...}}` (a placeholder is filled by its last path segment); same fill / walk / report |
| `test_load.js` | scratchpad/grv2/test_commit/load.js | code root `scratchpad/smv2/code` or `$V2_CODE_DIR`; exports `load.strip` / `load.root` |

Also copied, outside lib/: `code/worker_src_grv2/*.js` = scratchpad/grv2/code/worker/*.js (unchanged; package C generates the
LOT worker JS from it), `base/CHECK_REQUIRED_FIELD.v8.json` (pulled from dev; same md5 as scratchpad/pwv2/lift/src/).

## Use

```python
import sys; sys.path.insert(0, "<smv2>/lib")
import wfkit as K, v2build as V
doc = V.build_worker(V.worker_config(...))          # CONTRACT.md section 8 has the LOT values (checked on dev)
V.build([("LOT_V2_WORKER", fn)], out_dir, write)    # what build_lot.py does
```
```bash
python3 lib/lift/lift.py prepare/lift.json --check   # a package's lift config (sources = base/SM_LOCATION_TRANSFER.v82.json ids)
python3 lib/sqlcheck.py "<repo>/Stock Movement/Location Transfer/AsyncV2" test/sql_values.json
V2_CODE_DIR=<smv2>/code node -e "require('<smv2>/lib/test_load.js')('l1.js', ['commitL1'], ['shared/x.js'])"
```
