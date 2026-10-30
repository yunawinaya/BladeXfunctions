"""Prod paste folder - B12 (10-28): Create IA uses a plant-level login's own plant (SO Linked IAs page) and the SO list's By Item tab gets
the Linked IAs / Create IA line actions. Read-only on dev and prod: pulls the enabled copies, compares prod with the base each change was
built on (canonical JSON: key order ignored), checks the paste is what dev runs now, and writes into prod-hotfix/2026-10-28-so-by-item-ia/:
  1_SO_Linked_IAs_page.prod_paste.json / .prod_base.json    the whole page (dev v10 / prod now)
  2_SO_list.prod_paste.json / .prod_base.json               the whole page: prod v271 + the two row actions and their two handlers
--after: once pasted, checks prod runs the pastes (a difference is named by event script).

usage: python3 scratchpad/iasc/deploy/prod_folder_so_items.py [--write | --after]"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(REPO, "prod-hotfix", "2026-10-28-so-by-item-ia")
DB = os.path.join(REPO, ".dbtools", "db")
# n, name, page id, paste, the prod base it was built on
TARGETS = [
    (1, "SO_Linked_IAs_page", "2112449353901772801", "Item Assembly & BOM/SmallCycle/SOLinkedIAsPage.json", "scratchpad/iasc/base/page_so_linked_ias_v9.json"),
    (2, "SO_list", "1901872125787099137", "scratchpad/iasc/so_list/out/so_list_items_prod.json", "scratchpad/iasc/so_list/base/so_list_prod_v271.json"),
]
NEW = ["func_lineLinkedIas", "func_lineCreateIa"]
SQL = """SELECT version_number v, CAST(create_time AS CHAR) t, page_json j FROM su_code_pages_history WHERE data_id = %s AND status = 'enabled'
         ORDER BY version_number DESC LIMIT 1"""
# 3: the IA form (2098256587713404929), its one handler sc_main (B14: the SO line entry without the page's parameter, the components
# unlocked); prod v36's sc_main is dev v76's, the paste dev v77's
FORM_SQL = """SELECT h.version_number v, CAST(h.create_time AS CHAR) t, h.form_json j FROM su_code_tables_history h JOIN su_code_tables t ON
              t.id = h.data_id WHERE t.table_name = 'sm_item_assembly' AND h.status = 'enabled' ORDER BY h.version_number DESC LIMIT 1"""
FORM = ("scratchpad/iasc/client/out/on/IAform.json", "scratchpad/iasc/base/ia_form_v76.json", "scratchpad/iasc/base/ia_form_prod_v36.json")
HANDLER = "sc_main"


def enabled(env, page_id):
    r = subprocess.run([DB, env, "--json", SQL % page_id], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr[-400:]
    t = r.stdout.split("\n")
    k = [i for i, l in enumerate(t) if l.strip() in ("[", "[]") or l.startswith("[{")][0]
    rows = json.loads("\n".join(t[k:]))
    assert len(rows) == 1, (env, page_id, rows)
    return rows[0]


def canon(o):
    return json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def load(rel):
    return json.load(open(os.path.join(REPO, rel), encoding="utf-8"))


def by_item(page):
    def find(o):
        if isinstance(o, dict):
            return [o] if o.get("model") == "custom_r7tpmpsj" else [x for v in o.values() for x in find(v)]
        return [x for v in o for x in find(v)] if isinstance(o, list) else []
    return find(page["list"])[0]["options"]["customProps"]["rowActions"]


def ours(page):
    # the two row actions and their two handlers: what this paste adds. The actions are copies of the page's own View action, and dev's
    # View carries an empty dialog_top that prod's lacks (does nothing): left out of the comparison
    acts = [{k: v for k, v in a.items() if not (k == "dialog_top" and v == "")} for a in by_item(page)[2:]]
    return canon([acts, [e for e in page["config"]["eventScript"] if e.get("name") in NEW]])


def minus_ours(page):
    p = json.loads(json.dumps(page))
    del by_item(p)[2:]
    p["config"]["eventScript"] = [e for e in p["config"]["eventScript"] if e.get("name") not in NEW]
    return canon(p)


def named(before, now):
    b = {(e.get("key"), e.get("name")): e for e in before["config"]["eventScript"]}
    n = {(e.get("key"), e.get("name")): e for e in now["config"]["eventScript"]}
    empty = lambda e: not e.get("func") and not e.get("rules")
    out = ["%s %s" % (k[1], "dropped (empty: no code, no rules)" if empty(b[k]) else "DROPPED") for k in b if k not in n]
    out += ["%s ADDED" % k[1] for k in n if k not in b] + ["%s CHANGED" % k[1] for k in b if k in n and canon(b[k]) != canon(n[k])]
    rest = lambda p: canon({k: v for k, v in p.items() if k != "config"}) + canon({k: v for k, v in p["config"].items() if k != "eventScript"})
    return out + ([] if rest(before) == rest(now) else ["the layout or the page config CHANGED"])


def form_enabled(env):
    r = subprocess.run([DB, env, "--json", FORM_SQL], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr[-400:]
    t = r.stdout.split("\n")
    k = [i for i, l in enumerate(t) if l.strip() in ("[", "[]") or l.startswith("[{")][0]
    return json.loads("\n".join(t[k:]))[0]


def handler(form):
    hits = []

    def walk(o):
        if isinstance(o, dict):
            if o.get("name") == HANDLER and isinstance(o.get("func"), str):
                hits.append(o)
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(form)
    assert len(hits) == 1, (HANDLER, len(hits))
    return hits[0]


def without_handler(form):
    f = json.loads(json.dumps(form))
    handler(f)["func"] = ""
    return canon(f)


def form_target(write, after):
    paste_rel, base_rel, prod_base_rel = FORM
    prod, dev = form_enabled("--prod"), form_enabled("--dev")
    prod_o, mine = json.loads(prod["j"]), handler(load(paste_rel))["func"]
    print("3 IA_form %-9s sm_item_assembly: prod v%s (%s), dev v%s" % (HANDLER, prod["v"], prod["t"], dev["v"]))
    if after:
        print("  prod %s = the paste: %s | the rest of the form as v36: %s" % (HANDLER, "IDENTICAL" if handler(prod_o)["func"] == mine else "DIFFERS",
                                                                              "YES" if without_handler(prod_o) == without_handler(load(prod_base_rel)) else "NO"))
        return
    print("  prod %s = our base (dev v76's): %s | the paste = dev now: %s | the rest of the form as v36: %s" % (
        HANDLER, "IDENTICAL" if handler(prod_o)["func"] == handler(load(base_rel))["func"] else "DIFFERS",
        "IDENTICAL" if mine == handler(json.loads(dev["j"]))["func"] else "DIFFERS", "YES" if without_handler(prod_o) == without_handler(load(prod_base_rel)) else "NO"))
    if write:
        open(os.path.join(OUT, "3_IA_form_%s.prod_base.js" % HANDLER), "w", encoding="utf-8").write(handler(prod_o)["func"])
        open(os.path.join(OUT, "3_IA_form_%s.js" % HANDLER), "w", encoding="utf-8").write(mine)


def main():
    write, after = "--write" in sys.argv, "--after" in sys.argv
    if write:
        os.makedirs(OUT, exist_ok=True)
    form_target(write, after)
    for n, name, pid, paste_rel, base_rel in TARGETS:
        prod, dev = enabled("--prod", pid), enabled("--dev", pid)
        prod_o, dev_o, paste = json.loads(prod["j"]), json.loads(dev["j"]), load(paste_rel)
        print("%d %-18s %s: prod v%s (%s), dev v%s" % (n, name, pid, prod["v"], prod["t"], dev["v"]))
        if after:
            print("  prod = the paste: %s" % ("IDENTICAL" if canon(prod_o) == canon(paste) else "DIFFERS: " + "; ".join(named(paste, prod_o))))
            continue
        print("  prod = our base: %s" % ("IDENTICAL" if canon(prod_o) == canon(load(base_rel)) else "DIFFERS: " + "; ".join(named(load(base_rel), prod_o))))
        if n == 1:
            print("  paste = dev now: %s" % ("IDENTICAL" if canon(paste) == canon(dev_o) else "DIFFERS"))
        else:
            print("  the paste's actions + handlers = dev now: %s | the paste minus them = prod now: %s" % (
                "IDENTICAL" if ours(paste) == ours(dev_o) else "DIFFERS", "YES" if minus_ours(paste) == canon(prod_o) else "NO: " + "; ".join(named(prod_o, paste))))
        if write:
            stem = os.path.join(OUT, "%d_%s" % (n, name))
            json.dump(prod_o, open(stem + ".prod_base.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
            json.dump(paste, open(stem + ".prod_paste.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    if write:
        print("wrote", OUT)


if __name__ == "__main__":
    main()
