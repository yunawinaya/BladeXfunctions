---
name: authoring-lowcode-workflows
description: Use when creating or editing BladeX low-code workflow JSON (springblade/liteflow) - adding nodes, wiring {{node:...}} references, writing code-node scripts, building if/condition branches or loops, or before deploying any workflow JSON. Also use when a deployed workflow silently returns null, empty output, or a NullPointerException.
---

# Authoring low-code workflow JSON

**The platform fails silently.** Almost every mistake below produces `{}`, `null`, or a skipped
branch rather than an error — the workflow "succeeds" and the data is wrong. That is why the
linter exists and why these rules are worth reading before writing, not after.

## Mandatory before deploying

```
python3 scratchpad/validate.py "Module/SomeWorkflow.json"
```
Reports **MISSING** (ref to a nonexistent node), **FORWARD** (ref to a node that runs later),
**DIVERGENT** (ref across mutually exclusive branches — positionally fine, silently null at
runtime), **UNDECLARED** (code-node returns a key its `response_json` omits), **UNUSED**,
**CONDITIONAL** (informational). It scans BOTH reference forms — `{{node:X}}` templates *and*
`ConditionRule` `prop: "node.X.data..."` leaves. A `{{node:` grep alone misses the filter form.

## Picking a node

| Need | Use | Output path |
|---|---|---|
| One record | get-node | `.data` (a single OBJECT when count=1 — handle both shapes) |
| Many records | search-node | `.data.data`, has `limit` |
| Transform / branch flag | code-node | declared keys only (see contract) |
| Raw SQL, joins, aggregates | sql-node | single `.data`; placeholders **hand-quoted**; PHYSICAL lowercase table names |
| N independent fetches | condition-all-node | fork-JOIN; see Optimization |
| Per-item work | loop | `loopType:"Var"` + `loopSeletVar.code`; refs are `{{node:<loop_id>.<field>}}` |

**Code-nodes cannot call `db`.** DB access only via get/add/update/search/workflow nodes. Decompose
client functions into fetch → transform → persist.

**No field projection.** A fetch always returns the whole document. Optimize by eliminating,
batching or parallelizing fetches — never by trimming fields.

## Code-node contract (most common silent failure)

`data.response_json` **must declare one entry per key the script returns.** The runtime filters the
returned object down to the declared names; undeclared keys are dropped and the node outputs `{}`.
Downstream `{{node:X.data.someKey}}` then resolves to `null`, and an `if`-node on it throws a
NullPointerException.

```
return { required_fields, data }   ->  response_json: [{name:"required_fields"},{name:"data"}]
```

Placeholders inject a **JS expression** — never quote them. `'{{workflowparams:x}}'` produces a
nested-quote SyntaxError; write `{{workflowparams:x}}`.

## Expressions are MVEL, not JS

`if`-node conditions and condition-or filters support only `== != > < && ||`.
**No `===`, no `!==`, no `.indexOf`, no array literals.** A `===` silently evaluates false. To
match several values, chain `||` of `==`. Code-node bodies are still normal JS.

An `if` node's **true block must be non-empty** — an empty true `ifBlock` crashes the compiler.
Invert the condition so the populated branch is the true one.

Route branches by computing a typed flag in a code-node ("Determine Params"); do not embed
`workflowparams.X` selectors in branch filters.

## Optimization is required, not optional

Top-level nodes execute **one at a time**, so N independent lookups cost N round-trips. Group
mutually-independent get/search nodes into one `condition-all-node`:

- It is a fork-**JOIN** barrier: the next sibling waits for all branches.
- Branches run in parallel; nodes **within** one branch run sequentially (use that for a dependent
  chain). Branches may nest another `condition-all-node` to fan out again.
- Outputs made inside a branch are readable outside it — context is keyed by node id.
- A node needing outputs from two different branches is a barrier: place it AFTER the block.
- Never let two items in the same block reference each other.

Ship the parallel design on the first pass. Verify it afterwards from the DB: in a run's
`nodes_data`, if each node's `start_time_millis` equals the previous node's end, the branches are
serial and the fork-join is not doing its job.

## Filters and references

- Multi-condition WHERE in a get-node: wrap conditions in ONE `type:"branch"` with
  `operator:"all"`. Multiple top-level leaves do **not** AND together.
- search-node array filters use `equalAny`, not `in`. Do not add `is_deleted` (auto-filtered).
  Scope org-shared name lookups by `organization_id`.
- get-node `in` accepts a scalar — don't "fix" it to `equal`.
- FK fields are **raw ids** in workflow code-nodes. `r.fk?.subfield` works only in form/UI contexts.
- `db.collection()` wants the **display** name ("Goods Delivery"); raw SQL wants the physical name
  (`goods_delivery`). It reaches other schemas: `db.collection("sudu_billing.sudu_flex_topup")`.
- Node ids, filter numeric ids and code-node `response_json` keys are safe to invent.
  **Form-definition keys are not** — those are platform-generated.

## Deploy and verify

Deployment is the user's: paste into `designing`, then enable in the platform. There is no INSERT
grant, so it cannot be done from the DB. Immediately after they enable, confirm the paste landed:

```
.dbtools/wf --prod deployed "Module/SomeWorkflow.json"
```
`DIFFERS` against prod usually just means dev is ahead pending release — this repo is dev code.
See the `debugging-bladex-prod` skill for traces and deployment authority.

## Common mistakes

| Mistake | Silent result |
|---|---|
| Undeclared key in `response_json` | node outputs `{}` → downstream null → if-node NPE |
| `===` in an if-expression | always false; branch never taken |
| Quoted `'{{placeholder}}'` | SyntaxError inside the code-node |
| Empty true `ifBlock` | compiler crash |
| Multiple top-level filter leaves | conditions do not AND; wrong rows returned |
| `in` instead of `equalAny` for arrays | no matches |
| Reference across mutually exclusive branches | resolves null at runtime — linter DIVERGENT |
| Independent fetches left sequential | N round-trips instead of one slowest branch |
| Decimal column missing from the save workflow's formatNumber map | raw float → BigDecimal `multipleOf` rejects → save crashes |
