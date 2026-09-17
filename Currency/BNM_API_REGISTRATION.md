# BNM Exchange Rate — API registration

Register this once under the platform's **API / Data Source** screen. It lands in
`su_code_api`. The workflow `CURRENCY_REFRESH_RATE` (`2100436142094356481`) calls it
from the `api_bnm` node.

## Fields

| Field | Value |
|---|---|
| Name | `BNM Exchange Rate` |
| Method (`type`) | `GET` |
| Call type | `Backend` *(not Feign — Feign is for internal services)* |
| URL | `https://api.bnm.gov.my/public/exchange-rate` |
| Timeout | `30` seconds |
| Body type | `json` (unused for GET) |

## Auth — NoAuth, and the headers go on the workflow node

BNM needs a versioned `Accept` header, and the platform gets in the way of it.

**The platform attaches `Authorization: Bearer <...>` to every Backend call**,
whatever the auth block says — a NoAuth registration with no headers at all still
sent one (verified 2026-09-17: that call returned 403, where a request with no
`Authorization` returns 404). BNM's gateway parses `Authorization` *before* it
looks at `Accept`, cannot parse the platform's value, and answers **403 Forbidden**
with `"Authentication parameters missing"` — so the failure looks like an auth
problem even though `Accept` was never the issue.

Measured against BNM:

| Request | Result |
|---|---|
| no `Accept`, no `Authorization` | 404 |
| no `Accept`, `Authorization: Bearer …` | **403** |
| `Accept` ok, `Authorization: Bearer …` | **403** |
| `Accept` ok, `Authorization: None` (or any non-`Bearer` value) | 200 |

Only capital `Bearer <x>` is parsed; anything else falls through to public access.

| Field | Value |
|---|---|
| Auth type | `NoAuth` |

Both headers are sent by the workflow's `api_bnm` node, which overrides what the
platform would otherwise send:

```json
"headers": { "list": [
  { "prop": "Accept",        "valueType": "value",
    "value": "application/vnd.BNM.API.v1+json" },
  { "prop": "Authorization", "valueType": "value", "value": "None" }
] }
```

`Authorization: None` is not a credential — it exists only to displace the
platform's `Bearer` value so BNM's gateway stops trying to authenticate the call.
If BNM ever starts rejecting it, `open.er-api.com/v6/latest/MYR` needs no headers
at all and tolerates the platform's `Authorization` (its rates are MYR-based and
must be inverted).

## Query parameters (`param_type: query`)

| Name | Type | Value passed by the workflow |
|---|---|---|
| `quote` | string | `rm` |

Do **not** add a `session` parameter and do not use the `/date/YYYY-MM-DD` form —
both return `{"message":"No records found.","code":404}`. The bare query returns the
latest published session automatically.

## Response schema (`response_json`)

Declare exactly two top-level keys, both `any`, with **no children** — the code-node
consumes the raw array and nested declarations risk the platform reshaping it.

| Name | bsonType |
|---|---|
| `data` | `any` |
| `meta` | `any` |

## Live response shape (probed 2026-09-17)

```json
{
  "data": [
    {"currency_code": "SGD", "unit": 1,
     "rate": {"date": "2026-09-17", "buying_rate": 3.2053,
              "selling_rate": 3.2126, "middle_rate": 3.2089}},
    {"currency_code": "TWD", "unit": 100,
     "rate": {"date": "2026-09-17", "buying_rate": 12.8442,
              "selling_rate": 12.8845, "middle_rate": 12.8643}}
  ],
  "meta": {"quote": "rm", "session": "0900",
           "last_updated": "2026-09-17 11:51:21", "total_result": 27}
}
```

`unit` is load-bearing: 15 of the 27 currencies are quoted per **100** units
(AED, HKD, IDR, INR, JPY, KHR, KRW, MMK, NPR, PHP, PKR, SAR, THB, TWD, VND).
The code-node divides by it. No API key is required.

## After registering

Copy the new API's id, then in `CurrencyRefreshRatesWorkflow.json` replace both
occurrences of `2100437534892691457`:

```json
"api": {
  "rules": { "collectionId": "2100437534892691457", ... },
  "source": "BNM Exchange Rate:Api:2100437534892691457"
}
```

and re-paste the workflow into `CURRENCY_REFRESH_RATE`.

## Verify the registration alone

```
curl -s -H "Accept: application/vnd.BNM.API.v1+json" \
  "https://api.bnm.gov.my/public/exchange-rate?quote=rm"
```
