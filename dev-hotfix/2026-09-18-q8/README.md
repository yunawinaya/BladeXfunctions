# q8 rounding fix — PT / LOT / MSI (seeded from DEPLOYED, not the repo)

These three files are **deployed dev script + the 8dp rounding fix, nothing else**.

The repo copies of these workflows carry unreleased Stock Picking work
(`*spBuild` / `*spDocId` / `*spGuard`) that must not ship yet, so editing and deploying the
repo file would have taken that with it. Each file here was seeded from
`su_code_workflow_history.script_json WHERE status='enabled'` instead.

| file | source workflow | version seeded |
|---|---|---|
| `PTsaveWorkflowChangeFlow.json` | `SM_PLANT_TRANSFER` 2025864403783462913 | v101 |
| `LOTsaveWorkflow.json` | `SM_LOCATION_TRANSFER` 2013133675374927874 | v78 |
| `MSIsaveWorkflow.json` | `SM_MISC_ISSUE` 2015602242971631618 | v37 |

`*.BASE.json` is the untouched seed, kept only for diffing. **Do not deploy the `.BASE.json`
files.**

Verified: each file differs from its baseline in code nodes ONLY — PT 8, LOT 4, MSI 3 — with
zero non-code nodes changed and zero nodes added or removed. `code_node_PTspGuard`,
`code_node_PTspDocId`, `code_node_MSIspGuard` and `code_node_MSIspDocId` are untouched.

After deploying, the repo copies remain ahead (they still carry Stock Picking) and still lack
this rounding fix — reapply it there when the Stock Picking work ships.
