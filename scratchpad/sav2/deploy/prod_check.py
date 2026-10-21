#!/usr/bin/env python3
"""SA V2 / SC Review V2 - post-deployment check (READ-ONLY: SELECTs through .dbtools only).
   python3 scratchpad/sav2/deploy/prod_check.py [--dev]      (from the repo root; default --prod)
Checks that the environment runs exactly what this work shipped: the 6 workflows, the SA / SC forms and lists (switches ON,
real workflow ids), the stock_adjustment V2 columns, the 4 workflow names, the shared V2 tables with their UNIQUE keys, and the
engine workflows being present. Prints one line per check and ALL CHECKS PASSED or the failures."""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
ENV = "--dev" if "--dev" in sys.argv else "--prod"
SA = "Stock Adjustment/AsyncV2"
SC = "Stock Count/AsyncV2"
WORKFLOWS = [f"{SA}/SA_V2_SUBMIT.json", f"{SA}/SA_V2_WORKER.json", f"{SA}/SA_V2_PREPARE.json", f"{SA}/SA_V2_COMMIT.json",
             f"{SA}/STOCK_ADJUSTMENT.json", f"{SC}/STOCK_COUNT.json"]
NAMES = {"2111074320177860610": "SA_V2_SUBMIT", "2111074368689180673": "SA_V2_WORKER", "2111074403720007681": "SA_V2_PREPARE",
         "2111074444748689410": "SA_V2_COMMIT"}
FORMS = [("stock_adjustment", f"{SA}/SAform.json"), ("stock_count", f"{SC}/SCform.json")]
PAGES = [("SA list", "1902690404764073986", f"{SA}/SAlistPage.json"), ("SC list", "1970076277973823489", f"{SC}/SClistPage.json")]
ENGINE = {"2109916822821744641": "INVENTORY_BULK_APPLY", "2105936479113383937": "INVENTORY_LOCK_TOKENS"}
TABLES = {"gd_async_job": "Idempotency Key", "gd_publish_step": "Job Step", "inventory_balance_lock": "Lock Key"}
SWITCH_RE = re.compile(r"const (ASYNC_SA_ENABLED|ASYNC_SC_REVIEW_ENABLED|SA_BG_ENABLED|SCR_BG_ENABLED) = (true|false);")

fails = []


def check(what, ok, detail=""):
    print(("ok    " if ok else "FAIL  ") + what + (("  " + str(detail)) if detail and not ok else ""))
    if not ok:
        fails.append(what)


def sh(*args):
    return subprocess.run(list(args), cwd=ROOT, capture_output=True, text=True).stdout


def rows(sql):
    out = sh(".dbtools/db", ENV, "--json", sql)
    i = out.find("[")
    return json.loads(out[i:]) if i >= 0 else []


norm = lambda o: json.dumps(o, sort_keys=True, ensure_ascii=False)

for f in WORKFLOWS:
    out = sh(".dbtools/wf", ENV, "deployed", f)
    check(f"workflow {os.path.basename(f)} = repo", "IDENTICAL" in out, out.strip().splitlines()[-1] if out.strip() else "no answer")

got = {str(r["id"]): r["name"] for r in rows("SELECT CAST(id AS CHAR) id, name FROM su_code_workflow WHERE id IN (%s)" % ",".join(NAMES))}
for i, n in NAMES.items():
    check(f"workflow {i} named {n}", got.get(i) == n, got.get(i, "missing"))
eng = {str(r["id"]): r["v"] for r in rows("SELECT CAST(data_id AS CHAR) id, MAX(version_number) v FROM su_code_workflow_history WHERE data_id IN (%s) "
                                         "AND status = 'enabled' GROUP BY data_id" % ",".join("'%s'" % k for k in ENGINE))}
for i, n in ENGINE.items():
    check(f"engine {n} enabled", i in eng, "not enabled")

line = "PROD" if ENV == "--prod" else "DEV"
for table, f in FORMS:
    out = sh(".dbtools/form", "status", table, f)
    mine = [l for l in out.splitlines() if l.strip().startswith(line)]
    check(f"form {table} = repo", bool(mine) and "IDENTICAL" in mine[0], mine[0].strip() if mine else "no answer")

for name, pid, f in PAGES:
    r = rows("SELECT version_number, page_json FROM su_code_pages_history WHERE data_id = '%s' AND status = 'enabled' ORDER BY version_number DESC LIMIT 1" % pid)
    repo = json.load(open(os.path.join(ROOT, f)))
    repo = repo.get("page_json", repo) if isinstance(repo, dict) else repo
    live = r[0]["page_json"] if r else None
    live = json.loads(live) if isinstance(live, str) else live
    check(f"page {name} = repo", r and norm(live) == norm(json.loads(repo) if isinstance(repo, str) else repo), "v%s" % (r[0]["version_number"] if r else "-"))

# the shipped switches: every copy ON in the repo files the checks above compared
for f in [f for _, f in FORMS] + [f for _, _, f in PAGES]:
    text = open(os.path.join(ROOT, f), encoding="utf-8").read()
    states = set(m.group(2) for m in SWITCH_RE.finditer(text.replace('\\"', '"')))
    check(f"switches in {os.path.basename(f)} all ON", states == {"true"}, states)

cols = {r["c"] for r in rows("SELECT column_name c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'stock_adjustment' "
                             "AND column_name IN ('sa_v2_job_id', 'sa_idem_key')")}
check("stock_adjustment.sa_v2_job_id + sa_idem_key exist", cols == {"sa_v2_job_id", "sa_idem_key"}, cols)
for table, key in TABLES.items():
    r = rows("SELECT non_unique n FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = '%s' AND index_name = '%s' LIMIT 1" % (table, key))
    check(f"table {table} has UNIQUE `{key}`", bool(r) and str(r[0]["n"]) == "0", r)
for col in [("inventory_movement", "operation_effect_key")]:
    r = rows("SELECT 1 x FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '%s' AND column_name = '%s'" % col)
    check(f"column {col[0]}.{col[1]} exists", bool(r))

print("ALL CHECKS PASSED" if not fails else "%d CHECK(S) FAILED" % len(fails))
sys.exit(1 if fails else 0)
