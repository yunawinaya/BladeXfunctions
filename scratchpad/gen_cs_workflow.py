# -*- coding: utf-8 -*-
"""Generate Customer Statement/CSgenerateFilterWorkflow.json."""
import json, collections

SQL_NODE_ID = "sql_node_scfbcMVD"


def norm(param):
    """Strip [ ] " ' and spaces from a param so a multi-select array,
    a bare comma list, or a single value all normalise to `a,b,c`.
    NULLIF(...,'null') catches an UNRESOLVABLE placeholder, which the
    platform substitutes as the literal text `null`."""
    b = "COALESCE(NULLIF('{{workflowparams:%s}}','null'),'')" % param
    return ("REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(%s,'[',''),']',''),"
            "'\"',''),'''',''),' ','')" % b)


def dparse(expr):
    """Parse a normalised date token: date string, 10-12 digit epoch seconds,
    or 13+ digit epoch millis. Anything blank -> NULL (= filter disabled)."""
    return (
        "CASE\n"
        "             WHEN {e} = '' THEN NULL\n"
        "             WHEN {e} REGEXP '^[0-9]{{13,}}$' THEN DATE(FROM_UNIXTIME({e} / 1000))\n"
        "             WHEN {e} REGEXP '^[0-9]{{10,12}}$' THEN DATE(FROM_UNIXTIME({e}))\n"
        "             ELSE DATE({e})\n"
        "           END"
    ).format(e=expr)


SQL = """-- Customer Statement: AR invoices, enriched by lookup joins and aged.
-- Every filter is gated on BOTH its switch and a non-empty value, so a stale
-- value behind a switched-off toggle cannot leak in, and an unresolved
-- placeholder degrades to "no filter" instead of "no rows".
SELECT
    q.customer_id,
    q.customer_name,
    q.ar_invoice_no,
    q.invoice_date,
    q.due_date,
    q.payment_status,
    q.area_code,
    q.project_code,
    q.agent_name,
    q.payment_term,
    q.invoice_total_currency,
    q.invoice_total,
    q.myr_invoice_total,
    q.outstanding_amount,
    q.days_overdue,
    CASE WHEN q.days_overdue <= 0              THEN q.outstanding_amount ELSE 0 END AS aging_current,
    CASE WHEN q.days_overdue BETWEEN  1 AND 30 THEN q.outstanding_amount ELSE 0 END AS aging_1_30,
    CASE WHEN q.days_overdue BETWEEN 31 AND 60 THEN q.outstanding_amount ELSE 0 END AS aging_31_60,
    CASE WHEN q.days_overdue BETWEEN 61 AND 90 THEN q.outstanding_amount ELSE 0 END AS aging_61_90,
    CASE WHEN q.days_overdue > 90              THEN q.outstanding_amount ELSE 0 END AS aging_90_plus
FROM (
    SELECT
        COALESCE(cust.customer_id, '')                AS customer_id,
        COALESCE(cust.customer_com_name, '')          AS customer_name,
        COALESCE(ari.ar_invoice_no, '')               AS ar_invoice_no,
        COALESCE(DATE_FORMAT(ari.invoice_date, '%Y-%m-%d'), '') AS invoice_date,
        COALESCE(DATE_FORMAT(ari.due_date, '%Y-%m-%d'), '')     AS due_date,
        COALESCE(ari.payment_status, '')              AS payment_status,
        COALESCE(ara.area_code, '')                   AS area_code,
        COALESCE(pr.project_code, '')                 AS project_code,
        COALESCE(ag.agent_name, '')                   AS agent_name,
        COALESCE(pt.term_name, '')                    AS payment_term,
        COALESCE(ari.invoice_total_currency, '')      AS invoice_total_currency,
        ROUND(COALESCE(ari.invoice_total, 0), 2)      AS invoice_total,
        ROUND(COALESCE(ari.myr_invoice_total, 0), 2)  AS myr_invoice_total,
        ROUND(COALESCE(ari.outstanding_amount, 0), 2) AS outstanding_amount,
        -- Aging is measured against the statement date when that filter is on,
        -- otherwise against today. Gated on the switch for the same reason the
        -- row filter below is: a stale value behind an off switch must not count.
        GREATEST(COALESCE(DATEDIFF(
            COALESCE(CASE WHEN '{{{{workflowparams:statement_date_switch}}}}' = '1'
                          THEN p.stmt_date END, CURDATE()), ari.due_date), 0), 0) AS days_overdue
    FROM ar_invoice ari
    CROSS JOIN (
        SELECT
          p0.cust_ids,
          p0.area_ids,
          p0.proj_ids,
          {date_from} AS date_from,
          {date_to}   AS date_to,
          {stmt_date} AS stmt_date
        FROM (
          SELECT
            {n_cust} AS cust_ids,
            {n_area} AS area_ids,
            {n_proj} AS proj_ids,
            {n_dr}   AS dr,
            {n_sd}   AS sd
        ) p0
    ) p
    LEFT JOIN customer      cust ON cust.id = ari.customer_id
    LEFT JOIN area          ara  ON ara.id  = ari.area_id
    LEFT JOIN project       pr   ON pr.id   = ari.project_id
    LEFT JOIN agent         ag   ON ag.id   = ari.agent_id
    LEFT JOIN payment_terms pt   ON pt.id   = ari.payment_term_id
    WHERE ari.is_deleted = 0
      -- Org scope: ar_invoice rows created before organization_id was added to the
      -- SI/SO -> AR mapping have it NULL, but plant_id is written from the SAME
      -- source (`plant_id: record.organization_id` in both save workflows), so it
      -- is a correct fallback. A plain organization_id = ... returned zero rows.
      AND COALESCE(NULLIF(ari.organization_id, ''), ari.plant_id) = '{{{{global:firstLvDeptId}}}}'
      AND COALESCE(ari.payment_status, '') <> 'Cancelled'
      AND ( '{{{{workflowparams:customer_switch}}}}' <> '1'
            OR p.cust_ids = ''
            OR FIND_IN_SET(CAST(ari.customer_id AS CHAR), p.cust_ids) > 0 )
      AND ( '{{{{workflowparams:area_switch}}}}' <> '1'
            OR p.area_ids = ''
            OR FIND_IN_SET(CAST(ari.area_id AS CHAR), p.area_ids) > 0 )
      AND ( '{{{{workflowparams:project_switch}}}}' <> '1'
            OR p.proj_ids = ''
            OR FIND_IN_SET(CAST(ari.project_id AS CHAR), p.proj_ids) > 0 )
      AND ( '{{{{workflowparams:date_range_switch}}}}' <> '1'
            OR p.date_from IS NULL
            OR p.date_to IS NULL
            OR ( ari.invoice_date >= p.date_from
                 AND ari.invoice_date < DATE_ADD(p.date_to, INTERVAL 1 DAY) ) )
      AND ( '{{{{workflowparams:statement_date_switch}}}}' <> '1'
            OR p.stmt_date IS NULL
            OR DATE(ari.invoice_date) = p.stmt_date )
) q
ORDER BY q.customer_id, q.invoice_date, q.ar_invoice_no
LIMIT 5000;""".format(
    n_cust=norm("customer_ids"),
    n_area=norm("area_ids"),
    n_proj=norm("project_ids"),
    n_dr=norm("date_range"),
    n_sd=norm("statement_date"),
    date_from=dparse("SUBSTRING_INDEX(p0.dr, ',', 1)"),
    date_to=dparse("SUBSTRING_INDEX(p0.dr, ',', -1)"),
    stmt_date=dparse("p0.sd"),
)

# ---- schema -----------------------------------------------------------------
REQUEST = [
    ("a1c5uk9t", "customer_ids"),
    ("e4g8mz2p", "area_ids"),
    ("i7j2ns6w", "project_ids"),
    ("o0q6bv4x", "date_range"),
    ("u3y9dh1k", "statement_date"),
    ("f5r7lp3m", "customer_switch"),
    ("g8t2wz6n", "area_switch"),
    ("h1v4cs9b", "project_switch"),
    ("k6x8qm2d", "date_range_switch"),
    ("l9z3fj7r", "statement_date_switch"),
]

# (key, name, title, bsonType) -- order matches the SELECT list
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


def leaf(key, name, title, bson):
    d = collections.OrderedDict([
        ("key", key), ("name", name), ("title", title),
        ("description", ""), ("bsonType", bson), ("isExpand", False),
    ])
    if bson == "decimal":          # decimal leaves carry children: [] in the
        d["children"] = []         # verified Balance workflows; string ones don't
    return d


wf = collections.OrderedDict()
wf["request_json"] = [
    collections.OrderedDict([
        ("key", k), ("name", n), ("title", ""), ("description", ""),
        ("bsonType", "string"), ("isExpand", False),
    ]) for k, n in REQUEST
]
wf["response_json"] = [
    collections.OrderedDict([
        ("key", "y2p6tk4v"), ("name", "data"), ("title", "Data"),
        ("description", ""), ("bsonType", "array"), ("isExpand", True),
        ("children", [
            collections.OrderedDict([
                ("key", "x5n9bg1s"), ("name", "items"), ("title", ""),
                ("description", ""), ("bsonType", "object"), ("isExpand", True),
                ("isArrayItem", True),
                ("children", [leaf(*c) for c in COLUMNS]),
            ])
        ]),
    ])
]
wf["config"] = {}
wf["nodes"] = [
    collections.OrderedDict([
        ("id", "start"), ("type", "start-node"),
        ("data", collections.OrderedDict([
            ("isValidator", True), ("title", "Start Node"),
            ("nodeName", "Start Node"), ("name", "Start Node"),
        ])),
        ("blocks", []),
    ]),
    collections.OrderedDict([
        ("id", SQL_NODE_ID), ("type", "sql-node"),
        ("data", collections.OrderedDict([
            ("database_id", ""), ("sql", ""), ("params", {}),
            ("title", "Get Customer Statement"), ("isValidator", True),
            ("nodeName", "Get Customer Statement"), ("name", "Get Customer Statement"),
            ("script", collections.OrderedDict([("type", "sql"), ("code", SQL)])),
            ("response_json", [
                collections.OrderedDict([
                    ("key", "q7d3wm8f"), ("name", ""), ("title", ""),
                    ("description", ""), ("bsonType", "any"),
                    ("isExpand", False), ("children", []),
                ])
            ]),
        ])),
        ("blocks", []),
    ]),
    collections.OrderedDict([
        ("id", "end"), ("type", "end-node"),
        ("data", collections.OrderedDict([
            ("isValidator", True), ("title", "End Node"),
            ("nodeName", "End Node"), ("name", "End Node"),
            ("back_data_type", "OutputParams"),
            ("response_value", {"list": [collections.OrderedDict([
                ("prop", "data"), ("propLabel", "data"), ("operator", ""),
                ("operatorLabel", ""), ("valueType", "field"),
                ("valueTypeLabel", ""), ("valueLabel", ""),
                ("value", "{{node:%s.data}}" % SQL_NODE_ID),
            ])]}),
        ])),
        ("blocks", []),
    ]),
]
wf["edges"] = []

out = "Customer Statement/CSgenerateFilterWorkflow.json"
with open(out, "w") as f:
    json.dump(wf, f, indent=2, ensure_ascii=False)
    f.write("\n")
print("wrote", out)
