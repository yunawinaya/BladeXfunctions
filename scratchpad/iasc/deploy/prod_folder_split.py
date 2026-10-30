"""Prod paste folder - the IA split's No. of Split + Split alone, without the transfer request (the user, 10-29). Builds the IA form with
SC_NO_TR=1 (build_client_sc.py: no transfer-request widgets, events, mount call or NOT_RECORD models) into scratchpad/iasc/deploy/out_notr/,
checks prod still runs the base (v38: the 10-27 form + the 10-28 sc_main fix), that the paste differs from it by the split's parts only,
and writes prod-hotfix/2026-10-29-ia-split-only/1_IA_form.prod_paste.json / .prod_base.json. Read-only on prod.
--after: once pasted, prod = the paste.

usage: python3 scratchpad/iasc/deploy/prod_folder_split.py [--write | --after]"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
from compare_forms import canon, handlers, widgets  # noqa: E402

OUT = os.path.join(REPO, "prod-hotfix", "2026-10-29-ia-split-only")
BUILD = os.path.join(HERE, "out_notr")
BASE = os.path.join(REPO, "scratchpad", "iasc", "base", "ia_form_prod_v38.json")
DB = os.path.join(REPO, ".dbtools", "db")
SQL = """SELECT h.version_number v, CAST(h.create_time AS CHAR) t, h.form_json j FROM su_code_tables_history h JOIN su_code_tables t ON
         t.id = h.data_id WHERE t.table_name = 'sm_item_assembly' AND h.status = 'enabled' ORDER BY h.version_number DESC LIMIT 1"""
# what the split adds on top of v38, and nothing else
SPLIT = {"handlers added": ["os_onClick_split"], "handlers changed": ["iaV2_onClick_completed", "iaV2_onClick_completed_post", "os_main"],
         "widgets added": ["output_split_btn", "output_split_count", "output_split_pick"], "widgets changed": ["output_split"]}


def enabled(env):
    r = subprocess.run([DB, env, "--json", SQL], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr[-400:]
    t = r.stdout.split("\n")
    k = [i for i, l in enumerate(t) if l.strip() in ("[", "[]") or l.startswith("[{")][0]
    return json.loads("\n".join(t[k:]))[0]


def build():
    env = dict(os.environ, SC_NO_TR="1", SC_OUT_DIR=BUILD, PATH="/opt/homebrew/bin:" + os.environ.get("PATH", ""))
    b = subprocess.run([sys.executable, os.path.join(REPO, "scratchpad", "iasc", "client", "build_client_sc.py"), "--write"], env=env, capture_output=True, text=True)
    assert b.returncode == 0, b.stderr[-800:]
    return json.load(open(os.path.join(BUILD, "client_out", "on", "IAform.json"), encoding="utf-8"))


def delta(a, b):
    ha, hb, wa, wb = handlers(a), handlers(b), widgets(a), widgets(b)
    ca = {k: v for k, v in a["config"].items() if k != "eventScript"}
    cb = {k: v for k, v in b["config"].items() if k != "eventScript"}
    return {"handlers added": sorted(set(hb) - set(ha)), "handlers removed": sorted(set(ha) - set(hb)),
            "handlers changed": sorted(k for k in set(ha) & set(hb) if ha[k] != hb[k]), "widgets added": sorted(set(wb) - set(wa)),
            "widgets removed": sorted(set(wa) - set(wb)), "widgets changed": sorted(k for k in set(wa) & set(wb) if wa[k][0] != wb[k][0]),
            "widgets moved": sorted(k for k in set(wa) & set(wb) if wa[k][1:] != wb[k][1:]), "config": sorted(k for k in set(ca) | set(cb) if canon(ca.get(k)) != canon(cb.get(k)))}


def main():
    prod = enabled("--prod")
    prod_o = json.loads(prod["j"])
    print("prod IA form v%s (%s)" % (prod["v"], prod["t"]))
    if "--after" in sys.argv:
        paste = json.load(open(os.path.join(OUT, "1_IA_form.prod_paste.json"), encoding="utf-8"))
        d = delta(paste, prod_o)
        print("prod = the paste: %s" % ("IDENTICAL" if canon(prod_o) == canon(paste) else "DIFFERS: " + json.dumps({k: v for k, v in d.items() if v})))
        return
    base = json.load(open(BASE, encoding="utf-8"))
    print("prod = our base (v38): %s" % ("IDENTICAL" if canon(prod_o) == canon(base) else "DIFFERS: " + json.dumps({k: v for k, v in delta(base, prod_o).items() if v})))
    paste = build()
    d = {k: v for k, v in delta(base, paste).items() if v}
    print("the paste vs v38: %s" % json.dumps(d))
    print("the split's parts only: %s" % ("YES" if d == SPLIT else "NO"))
    if "--write" in sys.argv:
        assert d == SPLIT and canon(prod_o) == canon(base), "not written: prod moved or the paste carries more than the split"
        os.makedirs(OUT, exist_ok=True)
        json.dump(prod_o, open(os.path.join(OUT, "1_IA_form.prod_base.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        json.dump(paste, open(os.path.join(OUT, "1_IA_form.prod_paste.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print("wrote", OUT)


if __name__ == "__main__":
    main()
