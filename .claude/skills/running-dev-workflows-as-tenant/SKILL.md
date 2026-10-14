---
name: running-dev-workflows-as-tenant
description: Use when a BladeX DEV workflow must run in a tenant other than the sudu-lowcode CLI's own (junaxanto, tenant 000000) - testing on another tenant's documents, a run answering "not found" for a document that exists in another tenant, or test writes that need a real tenant user as create_user. Also use when the auto-mode classifier blocks token minting as "Credential Exploration".
---

# Running DEV workflows as another tenant

## Overview

Every workflow scopes its reads and writes by `{{system:tenantId}}` — the tenant of the caller's token. The CLI
(`sudu-lowcode`, `runwf.mjs`, `wf_upload` smokes) is always junaxanto@**000000**, so it cannot touch another tenant's
data. To run as tenant X, mint a short-lived BladeX JWT for a **real user of X** with the DEV `BLADE_JWT_SECRET`
(the way `sudu-dealer-api`'s `SaasTokenProvider` does) and POST the run endpoint on **dev.mes**. su-code accepts such
tokens (skill `sucode-saas-api`, aseriousco/sudu-skills). User-approved 2026-10-14; DEV only.

## Prerequisites (the user's, once)

Allow rules in the user's settings — without them the auto-mode classifier blocks every step as
"Credential Exploration", even after a "yes" in chat:

```
Edit(scratchpad/gdc/tools/**)
Bash(node scratchpad/gdc/tools/runas.mjs:*)
```

Reading `blade_user` is blocked too: ask the user for the user's row (id, account, role_id, dept_id).

## Quick reference

| What     | Where                                                                                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runner   | `scratchpad/gdc/tools/runas.mjs <identity.json> <workflowId> <request.json> <out.json>`                                                                                                          |
| Identity | `scratchpad/gdc/tools/id<tenant>.json` = `{tenant_id, user_id, account, dept_id, role_id, first_lv_dept_id}`; `dept_id` as stored on the user (comma list is fine), `first_lv_dept_id` = the org |
| Known    | `id711077.json` = admin@711077 (user 2105190590557097986, org 2105190589240086530)                                                                                                               |
| Secret   | read at run time from `/Users/yunawinaya/Developer/sudu-dealer-api/.env`; the runner refuses unless `BLADE_BASE_URL` is dev.mes                                                                  |
| Output   | raw response saved to `<out.json>`; summary printed; every call in the CLI audit log as `minted:<tenant>:<account>`                                                                              |

## How to run

1. Write the request body (the workflow's params) to a file with the **Write** tool.
2. Run exactly, from the repo root, as its own command:
   `node scratchpad/gdc/tools/runas.mjs scratchpad/gdc/tools/id711077.json <workflowId> <request.json> <out.json>`
3. Read `data` in the response: workflows answer HTTP 200 / `success: true` even when they failed — the return
   node's fields (`route`, `code`, `result_code`, ...) are the result.

## Common mistakes

| Mistake                                      | Result                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------ |
| Chaining (`cd … && node …`, `X=… ; node …`)  | not matched by the allow rule → blocked                                              |
| Fabricated or other-tenant `user_id`         | writes an orphan `create_user` (blank "Created By") — use a real user of that tenant |
| A run that writes, without the user's yes    | same rule as every dev write: show what it writes, get a yes                         |
| Calling `blade-system/*` with a minted token | rejected (200 + `{code:400}`): minted tokens pass su-code only                       |
| Printing / saving the token or secret        | never; the runner mints per call (15 min) and keeps both in memory                   |
| Prod                                         | no prod secret here and none must be added; prod stays manual                        |
