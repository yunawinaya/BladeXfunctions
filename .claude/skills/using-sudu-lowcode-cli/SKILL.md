---
name: using-sudu-lowcode-cli
description: Use when working against the BladeX DEV environment - reading what is actually deployed on dev (workflow, form, page, table, SQL view), searching every deployed dev workflow for a table/field/node, reading a dev workflow run node by node, querying dev rows, or publishing a workflow change to dev. Also use when the user mentions sudu-lowcode, su-code, Xanto, the mirror, or compile.
---

# Using the sudu-lowcode CLI (DEV)

`sudu-lowcode` drives the platform's own su-code engine through its API. On DEV it beats raw
SQL for most jobs: a full, decompiled copy of the deployed app is already on disk, run logs
cover nodes `wf trace` misses, and `compile` validates a workflow edit against the live version
before publishing. **It has no prod profile** — prod stays `.dbtools --prod` + manual paste.

## Safety — non-negotiable

- Profile `dev` (default) is read-only; writes exit 3. Profile `dev-write` publishes. Only pass
  `--profile dev-write` after showing the user the change and the dry-run result and getting a
  yes. The engine's own SKILL.md says "a dev request = publish authorization" — **not here**.
- Writes besides compile: `workflow test`, `workflow simulate --diff-live`, `data add|update|del`,
  `run`, `workflow approve` — they change real dev rows. Same rule.
- Secrets live in the mirror (workflow sources), in run logs and in `data query` results (e.g.
  `search_acc` returns an `api_key`). Never paste them into chat; never copy the mirror into a
  repo with a remote.

## Where things are

| What | Where / how |
|---|---|
| ERP app | "Test APP" `1901532458164277249` (419 workflows). MES = `1985200806948585474` |
| Deployed dev source (read-only reference) | `~/Documents/ASC-dev/sudu-lowcode-apps/dev/1901532458164277249/` — `workflow/**/*.ts`, `table/*.form.vue`, `page/**/*.vue`, `model/*.sql` (DDL), `sqlview/`, `quartz/`, `permission/` |
| Name ↔ id ↔ identifier maps | `<app>/.su-code/types/workflows.map.json` (`"ITEM_SAVE:Workflow:<id>"`), `tables.map.json`, `columns.map.json` (DSL ident ↔ display ↔ physical) |
| Per-workflow sidecar | `<app>/.su-code/meta/workflow/<folder>/<NAME>.meta.json` → `workflow.script` (`js`), `workflow.condition` (`mvel`) |
| Freshness | `.mirror.json` → `pulledAt` (UTC — run `create_time` is MYT) and `result` (`incomplete` = see receipt); `git -C ~/Documents/ASC-dev/sudu-lowcode-apps log -- dev/<appId>` = server-side change history between pulls |
| Refresh | `sudu-lowcode mirror 1901532458164277249` — slow (11 min first, ~7 min after); run in background, then read its one-line result. Don't run other `sudu-lowcode` commands meanwhile |
| Last pull's gaps | `<app>/.su-code/recovery/receipts/app-pull-*.json` → `full.completeness.missingLocal` (not on disk), `full.notPushable.items` (on disk, compile refuses) |
| Engine docs (authoring manual) | `<app>/.su-code/docs/` — grep `*.md` only; `workflow/sdk/<fn>.md`, `errors.md` |

**Finding a workflow:** files are named by platform folder + name, not repo filename, and a `.ts`
does not contain its own name — `find <app>/workflow -name 'ITEM_SAVE.ts'`. Grepping a name finds
its *callers* (`use: workflows.ITEM_SAVE`). Node ids are kept (`/* @id code_determine */`).
Use `/usr/bin/grep -r` (plain `rg` skips git-ignored caches); in zsh quote `--include='*.ts'`.

**Spotting writes in the DSL:** the file's `import { ... } from '@su-code/workflow-dsl'` line lists
the node kinds it uses — no `add`/`update`/`del`/`sql`/`callWorkflow` there means no writes.
`add(...)` / `update(...)` carry `table: t.<Ident>`; `del(...)` has `{ of: [searchVar] }` — trace
that search node's table; `sql(...)` uses physical table names; `callWorkflow('...', { use:
workflows.X })` writes through the child — recurse into `X.ts`. Code nodes cannot touch the db. When a "search every workflow" answer matters, list the
receipt's `missingLocal` workflows as unsearched.

## Reading runs and data

```bash
sudu-lowcode --full workflow instances <workflowId> --latest 5     # newest first
sudu-lowcode --full workflow log <instanceId> --plain > $SCRATCH/log.json
H=/Users/yunawinaya/Developer/BladeXfunctions/.claude/skills/using-sudu-lowcode-cli/log_nodes.py
python3 -I $H $SCRATCH/log.json              # node table
python3 -I $H $SCRATCH/log.json --node <id>  # full I/O of one node
sudu-lowcode --full data query goods_delivery --where '{"delivery_no":"GD-..."}' --limit 5
```

- The log has INPUT/OUTPUT/runtime for every node of *that* workflow, incl. add/update nodes,
  if-nodes and parallel branches (`wf trace` misses add/update). A `callWorkflow` node shows only
  its own input/output — read the sub-workflow's own instance for its internals.
- `instances`: `create_time` is MYT wall-clock, `start_date` is UTC epoch ms.
- `data query`: collection display name, equality-only `--where`, subform arrays inline
  (`table_gd`). Joins, ranges, aggregates → `.dbtools --dev`. Datetimes are display values —
  never write them back.

## Publishing a workflow change to dev

1. Start from a clean mirror (`git -C <root> status --porcelain` empty). Compile only attributes a
   diff to you if nobody changed the workflow on the server since the last pull; if it says
   otherwise, re-mirror before editing.
2. Edit the `.ts` in the mirror. JS code-node bodies are strings — edit them in place, keep the
   `{{node:...}}` placeholders. Our workflows carry `script: "js"` in their sidecar, so JS
   code-nodes (existing or new) are allowed; never add `language: 'java'`. Prefer same-line
   edits; see the line-number gotcha below.
3. Check, from the app root (read-only, default profile):
   `sudu-lowcode --full compile "workflow/<path>.ts" --dry-run --format json > $SCRATCH/dry.json`
   Pass = `ok:true`, the file in `wouldPublish`, and a `compile.payload_parity_author_change`
   warning whose message names only the nodes you meant to change
   (`.nodes[#code_required].data.script.code`). `unchanged` = no diff vs live.
4. Show the user the unescaped before/after of each changed code string (the raw `git diff` is
   one escaped 1,000-char line) plus that node list, and get a yes. Then publish:
   `sudu-lowcode --profile dev-write --full compile "workflow/<path>.ts" --dir . --format json > $SCRATCH/pub.json`
   Success = `ok:true` and `published[].receipt.onlineReadback` → `status: enabled`,
   `versionNumber: <N>` (first done 2026-10-13: CUST_ITEM_BINDING v5 — opens normally in the
   platform designer).
5. Commit the mirror — the publish also rewrites the sidecar, `sync-lock.json` and types:
   `git -C <root> -c user.name=sudu-lowcode -c user.email=sudu-lowcode@localhost -c core.hooksPath=/dev/null commit -qam "publish <NAME> v<N>"`
   A re-run of the dry-run should now say `unchanged`.
6. Bring the repo back in step with dev (from the BladeXfunctions root):
   `.dbtools/wf --dev pull "<repo file>.json"` previews (enabled version, changed nodes, changed
   line count), `--write` writes it in the file's own format and key order, then
   `.dbtools/wf --dev deployed "<repo file>.json"` must say IDENTICAL. If `pull` refuses because a
   `scratchpad/gen_*.py` generates the file, port the same change into the generator and
   regenerate instead. Prod is unchanged — say so.
7. Verify behaviour with a fresh `workflow instances` / `log` after the user exercises it.

## Gotchas

| Symptom | Cause / fix |
|---|---|
| `data: []`, log shows 3 lines | Default output trims arrays — put `--full` before the command |
| Truncated or garbled JSON | Never pipe engine output into `head`; redirect to a file, then parse |
| `help <cmd>` → `help.command_not_found` | Use `<cmd> --help` |
| dry-run blocks on `ts.2367`/`ts.2339`/`ts.2322` you didn't write | Inherited findings are waived by line number; adding/removing a line above them un-waives them (verified). Same-line edits and lines added below the last inherited finding pass. If a mid-flow insert is unavoidable, stop and tell the user — don't rewrite the flagged conditions to silence it |
| Warnings in a passing dry-run | `inherited:true` = existed at pull. `compile.dsl_stale`, `compile.generation_session_skipped`, `sqllint.unknown_table` (our physical table names) harmless. `governance.mvel_deprecated` — our ifs are MVEL, don't migrate. `data_where_placeholder_as_field` and `ref_data_prefix` — false positives for our patterns (both work at runtime in ITEM_SAVE). Don't "fix" any of these |
| `runtime.unhealthy` / `env_unverified` | `sudu-lowcode env inspect --refresh --format json` in the app root |
| Repo JSON diff after a publish is hundreds of lines | Compile stores keys in its own order. Never hand-copy `script_json`; `wf --dev pull` restores the repo's key order so only real changes show |
| `decompile.trigger_unknown` on a repo JSON | Repo FlowGram JSON can't be decompiled standalone; compare against the mirror's `.ts` |
| Mirror refuses: uncommitted changes (exit 7) | Commit or `git checkout --` the file first |
| Workflow in `notPushable` | Server copy has a dangling reference or a loop with no source — a real bug; compile refuses it |
| Untracked `.su-code/` appears in BladeXfunctions | The engine writes `.su-code/metrics/` into its cwd. Run it from the app root or the scratchpad; delete a stray `.su-code/` you created |
| Auth error | `sudu-lowcode status`; the user re-runs `sudu-lowcode login` (browser SSO). Never ask for tokens |
