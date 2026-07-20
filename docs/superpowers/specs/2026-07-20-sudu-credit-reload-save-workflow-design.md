# Sudu Credit Reload — save workflow design

Date: 2026-07-20

## Context

`Sudu AI/Credit Reload/SuduCreditReloadFullJSON.json` has form logic (customer autofill, currency/exchange rate, credit and total calculation) but **no save path at all** — `button_save.onClick` is empty. Records cannot currently be created from the form.

Two callers need to create Credit Reload records:

1. **Form** — the user fills the document and presses Save.
2. **Headless** — an automated caller supplies only `tenant_id`, `reload_type` and `reload_amount`, and everything else must be derived server-side.

Because the headless caller has none of the form's computed values, the calculation currently living in `SuduCreditReloadRecalculate.js` has to exist inside the workflow.

## Decisions

| Question | Decision |
|---|---|
| Does saving update the customer's balances? | **Yes, as of 2026-07-20** — superseding the original document-only decision. `add_node_cr` is followed by a `workflow-node` (`workflow_cr_produce`) calling `ProduceCreditWorkflow`, which moves `sub_remain_credit` / `reload_remain_credit` on Sudu Customer and writes an `AI Credit Movement` ledger row. It sits inside `ifBlock_if_cr_edit_false`, so it runs on **Add only** — never on the payment-settling Edit. Monthly Subscription **resets** the subscription bucket; Add On **accumulates** onto the reload bucket. Credit is granted regardless of `payment_status`, so an Unpaid reload still grants credit. |
| Headless invoice number | Workflow looks up the rule in the serial-number rule table matching `business_type = "Reload Invoice"` **and** `is_draft = 0` **and** `is_default = 1`, and writes it to `reload_invoice_no_type`, letting the platform generate the number exactly as the form does. The three conditions sit in one `branch`/`all` wrapper — multiple top-level leaves do not AND. The form additionally scopes by `department_id = {{global:firstLvDeptId}}`; the workflow deliberately omits it, because a headless caller may have no department context and an empty match would yield no invoice number. Consequence: if two organizations each define a default Reload Invoice rule, the workflow takes whichever the table returns first. |
| Scope | **Add + Edit in one workflow.** Edit exists only to settle payment, so it writes the payment fields and skips all derivation. |
| Headless `payment_status` | `Unpaid` — same as a form-created record. |
| Amount on type change | `onChange_reload_type` resets `reload_amount` to 45 **unconditionally**, discarding any value the user had typed. This is intentional: each reload type re-establishes the standard package price, and a custom amount must be re-entered per type. Do not "fix" this to only-fill-when-empty. |
| Structure | **One workflow, one id, always recompute server-side** (approach A). |

### Why always recompute

The pricing rules (`BASE_AMOUNT = 45`, `BASE_CREDIT = 10000`, `TAX_RATE = 0.08`) live in exactly one place — the workflow. The form's client-computed values are overwritten on save. Form and headless therefore cannot drift, and moving pricing into the Sudu Item table later is a one-node change.

This repo already has a live example of the failure this avoids: `remain_sub_credit` vs `sub_remain_credit`, the same concept spelled two ways in two forms, silently returning `undefined` for months.

## Table references

| Purpose | Source string |
|---|---|
| Credit Reload (target) | `Sudu Credit Reload:Table:1983746316466860034` |
| Customer lookup | `Sudu Customer:Table:1983717165334331394` |
| Currency / exchange rate | `Currency:Table:1902047936116805633` |
| Serial-number rule | `流水号规则表:Table:1994006139209117697` |

## Architecture

The workflow JSON format has **no edge list** — flow is sequential within a `blocks` array and branching is expressed by nesting. A node placed *after* an `if`, at the same level, runs for both branches. That is what lets the two modes converge on shared logic.

```
start
code_cr_determine ........ typed routing flags + normalized input
if_cr_edit ............... isEdit == 'Y'
 ├─ true ── code_cr_payment_entry → update_node_cr → get_node_cr
 └─ false ─ if_cr_headless ....... isHeadless == 'Y'
             ├─ true ── cond_all_cr_lookup (parallel)
             │           ├─ Branch 1: get_node_customer   (tenant_id2 = input.tenant_id)
             │           └─ Branch 2: search_node_serial  (is_default = 1)
             │          get_node_currency   (depends on customer → sequential)
             │          code_cr_headless_norm
             └─ false ─ code_cr_form_norm
            code_cr_calc ......... shared calculation + decimal formatting
            add_node_cr
code_cr_result ........... picks add-node vs get-node result
end
```

`code_cr_calc` converges the two normalize branches with the established idiom from `code_pi_fillback`:

```js
let entry = {{node:code_cr_headless_norm.data.entry}} || {{node:code_cr_form_norm.data.entry}};
```

Routing flags are computed in `code_cr_determine` and branched on as `{{node:code_cr_determine.data.isEdit}}`, rather than embedding `workflowparams` selectors in branch filters.

**Parallelism:** in the headless branch, the customer lookup and the serial-rule lookup are independent, so they run as two `condition-all-node-item` branches. Only the currency lookup genuinely depends on the customer (it needs `customer_currency_id`) and stays sequential after the fork-join.

## Contracts

`request_json` declares a single `any` param named `data`.

```js
// form
{ data: { ...this.getValues(), mode: "form" } }

// headless — always Add
{ data: { mode: "headless", tenant_id: "...", reload_type: "Add On", reload_amount: 45 } }
```

`response_json` returns `id` and `reload_invoice_no`.

## Calculation (`code_cr_calc`)

A server-side port of `SuduCreditReloadRecalculate.js`, run for **both** modes:

```
credits      = round(reload_amount / 45 * 10000)
total_gross  = reload_amount
total_tax    = total_gross * 0.08          // exclusive, added on top
total_amount = total_gross + total_tax
total_myr    = total_amount * exchange_rate

Monthly Subscription: sub_remain_after    = credits            (reset, ignores before)
                      reload_remain_after = reload_remain_before
Add On:               reload_remain_after = reload_remain_before + credits
                      sub_remain_after    = sub_remain_before
anything else:        both *_after = their *_before
```

Two values where the payload wins if present, so a form record is not silently rewritten:

- `exchange_rate` — preserves a manual override. Absent (headless), it comes from the currency lookup's `currency_buying_rate`, defaulting to `1` for `MYR` and `----`, which are equivalent.
- the `*_before` balances — preserves the balances as they were when the form was opened. Absent (headless), they are read off the fetched customer's `sub_remain_credit` / `reload_remain_credit`.

### Decimal formatting

This node doubles as the format allow-list — the single pass that must name every decimal column, or an unformatted float reaches the column and `multipleOf` rejects the save.

| Field | Format |
|---|---|
| `reload_amount`, `total_gross`, `total_tax_amount`, `total_amount`, `total_amount_myr` | `.toFixed(2)` |
| `exchange_rate` | `.toFixed(6)` |
| `ai_credit_reload_amount`, `sub_remain_before/after`, `reload_remain_before/after` | integer |

Following `POsaveWorkflow`'s `code_fillback`, the `toFixed` results stay **strings** rather than being re-parsed through `parseFloat` — that is what avoids the `multipleOf` rejection.

## Error handling

Early-exit end-nodes using `back_data_type: "Default"` with a numeric `code` and a `msg`, surfaced to the client as `error.data.msg`.

| Code | Condition |
|---|---|
| 400 | headless payload missing `tenant_id` / `reload_type` / `reload_amount`, or amount ≤ 0 |
| 404 | no Sudu Customer matches the given `tenant_id` |
| 406 | form payload missing `tenant_2` (customer) / `reload_type` / `reload_amount` |

An unrecognised `reload_type` is **not** an error — the record saves with both balances left equal to their before values, matching existing client behaviour.

If the currency lookup returns nothing, the workflow proceeds with `exchange_rate = 1` rather than failing; a missing currency must not block a reload.

## Client-side changes

Three, all currently missing:

1. **`onMounted` must set `page_status`.** It is a hidden input defaulting to `""` and nothing populates it. Without this the Edit/Add branch never resolves. Add the standard `this.isAdd ? 'Add' : this.isEdit ? 'Edit' : 'View'` resolution.
2. **A save handler** — new `SuduCreditReloadSave.js`, wired to `button_save.onClick`, calling `this.runWorkflow(id, { data }, onSuccess, onError)` following `PIsaveAsDraft.js`.
3. Both are written into the form JSON and then **extracted to `.js` files from the JSON**, so the files cannot drift from what actually ships.

## Verification

1. Structural: valid JSON; every `{{node:<id>...}}` selector resolves to a node that exists; every key read off a code node is declared in its `response_json`; every `if` has a non-empty true block; no `===` in `if` expressions.
2. Form Add — fill the form, Save, confirm a row lands in Sudu Credit Reload with an auto-generated invoice number and correctly formatted decimals.
3. Form Edit — reopen, flip `payment_status` to Paid, Save; confirm only payment fields changed and no second row was created.
4. Headless — call with `{ mode: "headless", tenant_id, reload_type: "Add On", reload_amount: 45 }`; confirm the row matches what the form produces for the same customer and inputs (credits 10000, gross 45.00, tax 3.60, total 48.60).
5. Headless error paths — bad tenant → 404; missing amount → 400.
6. Confirm the Sudu Customer row is **unchanged** (document-only decision).

## Open items

- Deploying produces a **new workflow id** that must be pasted into `SuduCreditReloadSave.js`.
- Pricing constants are hardcoded. The Sudu Item table (`1984112444644995073`) already carries a `reload_credit` column feeding `sub_package` on the Customer form — the natural home for this later.
- The three dangling invoice-no handler refs (`br9ru0le`, `iqydixjo`, `3ivhvcbg`) are untouched and remain outstanding.
