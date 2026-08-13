# -*- coding: utf-8 -*-
"""Splice the CS list-page table config in place.

Textual splice rather than json.load/json.dump so the other 70KB of the file
stay byte-identical (a full re-dump would reformat every line).
"""
import json, re

PATH = "Customer Statement/CSfullListPageJSON.json"
src = open(PATH).read()
orig = src

# (workflow response_json key, column name, header, bsonType)
COLUMNS = [
    ("g8j7bg0q", "customer_id",            "Customer Code",  "string"),
    ("k3m8pq2w", "customer_name",          "Customer Name",  "string"),
    ("uwfy3ygc", "ar_invoice_no",          "Invoice No",     "string"),
    ("6kpaq7yb", "invoice_date",           "Invoice Date",   "string"),
    ("r7t4nv9x", "due_date",               "Due Date",       "string"),
    ("b2d6hs1z", "payment_status",         "Payment Status", "string"),
    ("w9x5cf3k", "area_code",              "Area",           "string"),
    ("t8n2ja6v", "project_code",           "Project",        "string"),
    ("m4q7ez0p", "agent_name",             "Agent",          "string"),
    ("v6b3lu8r", "payment_term",           "Payment Term",   "string"),
    ("xo94dckh", "invoice_total_currency", "Currency",       "string"),
    ("h1s9do5c", "invoice_total",          "Invoice Total",  "decimal"),
    ("ls72y749", "myr_invoice_total",      "Total (MYR)",    "decimal"),
    ("z5f2wk7t", "outstanding_amount",     "Outstanding",    "decimal"),
    ("c8r4mp1n", "days_overdue",           "Days Overdue",   "decimal"),
    ("j3v7bq9d", "aging_current",          "Current",        "decimal"),
    ("n6k1xs4h", "aging_1_30",             "1-30 Days",      "decimal"),
    ("p9w5tz2m", "aging_31_60",            "31-60 Days",     "decimal"),
    ("d2iu8cv6", "aging_61_90",            "61-90 Days",     "decimal"),
    ("s7l3nr0q", "aging_90_plus",          "90+ Days",       "decimal"),
]

# (workflow request_json param, page model bound to it)
URL_PARAMS = [
    ("customer_ids",          "customer_id"),
    ("area_ids",              "area_id"),
    ("project_ids",           "project_id"),
    ("date_range",            "date_range"),
    ("statement_date",        "statement_date"),
    ("customer_switch",       "customer_switch"),
    ("area_switch",           "area_switch"),
    ("project_switch",        "project_switch"),
    ("date_range_switch",     "date_range_switch"),
    ("statement_date_switch", "statement_date_switch"),
]


def column(key, name, title, bson):
    return {
        "key": key, "name": name, "title": title, "description": "",
        "bsonType": bson, "isExpand": False,
        "fixed": "none", "width": 0,
        "align": "right" if bson == "decimal" else "left",
        "hidden": False, "defaultHidden": False, "hoverView": False,
        "showType": "", "isAllowEdit": [], "allowEditFx": "",
        "editMethod": "default", "updateMethods": "auto",
        "configString": {}, "configNumberPercent": {}, "configProgress": {},
        "configCurrency": {}, "configPhoneNumber": {}, "configBoolean": {},
        "configTag": {}, "configIcon": {}, "configLink": {}, "configButton": {},
        "configRating": {}, "configDate": {}, "configCustom": {},
    }


def url_param(prop, model):
    return {
        "prop": prop, "propLabel": prop, "operator": "", "operatorLabel": "",
        "valueType": "field", "valueTypeLabel": "", "valueLabel": "",
        "is_negative_number": False, "value": "{{value:%s}}" % model,
    }


def render(obj, base_indent):
    """json.dumps at the file's 2-space style, re-indented to sit at base_indent."""
    text = json.dumps(obj, indent=2, ensure_ascii=False)
    pad = " " * base_indent
    lines = text.split("\n")
    return lines[0] + "\n" + "\n".join(pad + l for l in lines[1:])


def span(text, open_idx):
    """Byte range of the bracketed value starting at open_idx, quote-aware."""
    opener = text[open_idx]
    closer = {"[": "]", "{": "}"}[opener]
    depth, i, in_str, esc = 0, open_idx, False, False
    while i < len(text):
        c = text[i]
        if in_str:
            if esc:            esc = False
            elif c == "\\":    esc = True
            elif c == '"':     in_str = False
        elif c == '"':         in_str = True
        elif c == opener:      depth += 1
        elif c == closer:
            depth -= 1
            if depth == 0:
                return open_idx, i + 1
        i += 1
    raise AssertionError("unbalanced bracket")


def splice(text, anchor, payload, indent):
    """Replace the value of `anchor` (e.g. '"columns": [') with payload."""
    assert text.count(anchor) == 1, "anchor not unique: %s (%d)" % (anchor, text.count(anchor))
    at = text.index(anchor)
    open_idx = at + len(anchor) - 1
    lo, hi = span(text, open_idx)
    return text[:lo] + render(payload, indent) + text[hi:]


# --- the vtable's `columns` is the only one preceded by this exact key ---
# (the customer/area/project table-selects also have `columns`, so anchor on the
#  unique first stub column key instead of on the word "columns").
COLUMNS_ANCHOR = '"columns": [\n            {\n              "key": "g8j7bg0q",'
assert src.count(COLUMNS_ANCHOR) == 1, "columns anchor not unique"
at = src.index(COLUMNS_ANCHOR)
open_idx = src.index("[", at)
lo, hi = span(src, open_idx)
src = src[:lo] + render([column(*c) for c in COLUMNS], 10) + src[hi:]

src = splice(src, '"url_params": {', {"list": [url_param(*p) for p in URL_PARAMS]}, 10)

# --- scalars ---
for before, after, why in [
    ('"data_field": ""', '"data_field": "data"',
     "row array sits at data.data in the workflow response"),
    ('"pagingEnabled": 1,\n          "pageWay"', '"pagingEnabled": 0,\n          "pageWay"',
     "workflow returns every row in one shot; no server-side paging"),
]:
    assert src.count(before) == 1, "scalar anchor not unique: %s" % before
    src = src.replace(before, after)

json.loads(src)          # fail loudly rather than write broken JSON
open(PATH, "w").write(src)
print("patched", PATH)
