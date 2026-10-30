"""Prod paste folder - Create IA from an SO line (Select Plant, no-BOM block, forms on the right) and the SO list's Convert to GD
plant warning (10-28). Read-only on dev and prod: pulls the enabled copies, compares prod with the base each change was built on
(canonical JSON: key order ignored), checks the paste is what dev runs now, and writes into prod-hotfix/2026-10-28-so-create-ia/:
  1_SO_Linked_IAs_page.prod_paste.json / .prod_base.json        the whole page (dev v9 / prod now)
  2_SO_list_onConfirm_selectPlant.js / .prod_base.js            the SO list's one handler (dev v541 / prod now); nothing else changes
--after: once pasted, checks prod runs the paste (the page whole; the SO list's handler, every other event script as before).

usage: python3 scratchpad/iasc/deploy/prod_folder_so.py [--write | --after]"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(REPO, "prod-hotfix", "2026-10-28-so-create-ia")
DB = os.path.join(REPO, ".dbtools", "db")
PAGE = ("2112449353901772801", "Item Assembly & BOM/SmallCycle/SOLinkedIAsPage.json", "scratchpad/iasc/base/page_so_linked_ias_v8.json")
LIST = ("1901872125787099137", "scratchpad/iasc/so_list/out/so_list_prod.json", "scratchpad/iasc/so_list/base/so_list_prod_v270.json")
HANDLER = "onConfirm_selectPlant"
SQL = """SELECT version_number v, CAST(create_time AS CHAR) t, page_json j FROM su_code_pages_history WHERE data_id = %s AND status = 'enabled'
         ORDER BY version_number DESC LIMIT 1"""


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


def func(page, name):
    hits = [e for e in page["config"]["eventScript"] if e.get("name") == name]
    assert len(hits) == 1, (name, len(hits))
    return hits[0]["func"]


def others(page):
    # the page minus the one handler's code: what must stay as it is
    p = json.loads(json.dumps(page))
    for e in p["config"]["eventScript"]:
        if e.get("name") == HANDLER:
            e["func"] = ""
    return canon(p)


def moved(before, now):
    # the event scripts that differ, by name; a dropped entry with no code and no rules is a designer leftover (does nothing)
    b = {(e.get("key"), e.get("name")): e for e in before["config"]["eventScript"] if e.get("name") != HANDLER}
    n = {(e.get("key"), e.get("name")): e for e in now["config"]["eventScript"] if e.get("name") != HANDLER}
    empty = lambda e: not e.get("func") and not e.get("rules")
    out = ["%s %s" % (k[1], "dropped (empty: no code, no rules)" if empty(b[k]) else "DROPPED") for k in b if k not in n]
    out += ["%s ADDED" % k[1] for k in n if k not in b] + ["%s CHANGED" % k[1] for k in b if k in n and canon(b[k]) != canon(n[k])]
    rest = lambda p: canon({k: v for k, v in p.items() if k != "config"}) + canon({k: v for k, v in p["config"].items() if k != "eventScript"})
    return out + ([] if rest(before) == rest(now) else ["the layout or the page config CHANGED"])


def main():
    write, after = "--write" in sys.argv, "--after" in sys.argv
    pid, paste_rel, base_rel = PAGE
    prod, dev = enabled("--prod", pid), enabled("--dev", pid)
    prod_o, paste = json.loads(prod["j"]), load(paste_rel)
    lid, lpaste_rel, lbase_rel = LIST
    lprod, ldev = enabled("--prod", lid), enabled("--dev", lid)
    lprod_o, lpaste, lbase = json.loads(lprod["j"]), load(lpaste_rel), load(lbase_rel)
    mine = func(lpaste, HANDLER)
    print("1 SO Linked IAs page %s: prod v%s (%s), dev v%s" % (pid, prod["v"], prod["t"], dev["v"]))
    print("2 Sales Order list   %s: prod v%s (%s), dev v%s" % (lid, lprod["v"], lprod["t"], ldev["v"]))
    if after:
        print("1 prod = the paste: %s" % ("IDENTICAL" if canon(prod_o) == canon(paste) else "DIFFERS"))
        now = func(lprod_o, HANDLER)
        print("2 %s = the paste: %s | every other event script, the config and the layout as v270: %s" % (
            HANDLER, "IDENTICAL" if now == mine else ("IDENTICAL but for surrounding whitespace" if now.strip() == mine.strip() else "DIFFERS"),
            "YES" if others(lprod_o) == others(lbase) else "NO: " + "; ".join(moved(lbase, lprod_o))))
        return
    print("1 prod = our base (dev v8): %s | paste = dev now: %s" % ("IDENTICAL" if canon(prod_o) == canon(load(base_rel)) else "DIFFERS",
                                                                  "IDENTICAL" if canon(paste) == canon(json.loads(dev["j"])) else "DIFFERS"))
    print("2 prod = our base (prod v270): %s | %s = dev now: %s | the paste changes only %s: %s" % (
        "IDENTICAL" if canon(lprod_o) == canon(lbase) else "DIFFERS", HANDLER, "IDENTICAL" if mine == func(json.loads(ldev["j"]), HANDLER) else "DIFFERS",
        HANDLER, "YES" if others(lpaste) == others(lprod_o) and mine != func(lprod_o, HANDLER) else "NO"))
    if write:
        os.makedirs(OUT, exist_ok=True)
        json.dump(prod_o, open(os.path.join(OUT, "1_SO_Linked_IAs_page.prod_base.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        json.dump(paste, open(os.path.join(OUT, "1_SO_Linked_IAs_page.prod_paste.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        open(os.path.join(OUT, "2_SO_list_%s.prod_base.js" % HANDLER), "w", encoding="utf-8").write(func(lprod_o, HANDLER))
        open(os.path.join(OUT, "2_SO_list_%s.js" % HANDLER), "w", encoding="utf-8").write(mine)
        print("wrote", OUT)


if __name__ == "__main__":
    main()
