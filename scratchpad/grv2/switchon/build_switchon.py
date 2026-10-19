"""Switch-on of the inbound V2 paths in the browser: GR Save as Completed, GR list Revert, Putaway Completed.

Bases = the dev-enabled versions, pulled read-only into this folder (GR form v1475, GR list page v212, Putaway form v366,
Putaway list page v32). Each gets its V2 handler with the switch true (+ workflow ids); the two lists also start their
worker when they open. A base that already carries a handler (the live version, re-seeded) takes it from the repo mirror. Writes the repo paste files + .js mirrors, then lists every path that differs from dev (must be
only the intended ones).
  python3 build_switchon.py [--write]
"""
import copy
import json
import os
import random
import re
import string
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(HERE, ".."))
from fmt import render  # noqa: E402

GR_FORM = (os.path.join(HERE, "gr_form_v1475.json"), os.path.join(ROOT, "Goods Receiving", "GRfullJSON.json"))
GR_LIST = (os.path.join(HERE, "gr_list_v212.json"), os.path.join(ROOT, "Bulk Actions", "Procurement", "Goods Receiving", "GRlistPageJSON.json"))
PW_FORM = (os.path.join(HERE, "pw_form_v366.json"), os.path.join(ROOT, "Putaway", "PutawayFullJSON.json"))
PW_LIST = (os.path.join(HERE, "pw_list_v32.json"), os.path.join(ROOT, "Putaway", "PutawayListPageJSON.json"))
GRC = os.path.join(ROOT, "Goods Receiving", "CompleteV2", "grc_onClick_completed.js")
GRV = os.path.join(ROOT, "Goods Receiving", "RevertV2", "grv_list_RevertCompletedGR.js")
GRV_KICK = os.path.join(ROOT, "Goods Receiving", "RevertV2", "grv_list_mounted_kick.js")
PWV = os.path.join(ROOT, "Putaway", "AsyncV2", "pwV2_onClick_completed.js")
PW_KICK = os.path.join(ROOT, "Putaway", "AsyncV2", "pwV2_list_mounted_kick.js")
PW_IDS = {"SUBMIT": "2110545826201112577", "WORKER": "2110545857423511553"}


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def switch_on(text, flag):
    old, on = "const %s = false;" % flag, "const %s = true;" % flag
    if text.count(on) == 1 and old not in text:  # the mirror is written back switched on
        return text
    assert text.count(old) == 1, (flag, text.count(old))
    return text.replace(old, on)


def by_name(form):
    out = {}
    for e in form["config"]["eventScript"]:
        assert e["name"] not in out, "two handlers named " + e["name"]
        out[e["name"]] = e
    return out


def new_key(form, rng):
    taken = set(re.findall(r'"([a-z0-9]{8})"', json.dumps(form)))
    while True:
        k = "".join(rng.choice(string.ascii_lowercase + string.digits) for _ in range(8))
        if k not in taken and not k.isdigit():
            return k


def find_model(n, model):
    if isinstance(n, dict):
        if n.get("model") == model:
            return n
        for v in n.values():
            r = find_model(v, model)
            if r is not None:
                return r
    elif isinstance(n, list):
        for v in n:
            r = find_model(v, model)
            if r is not None:
                return r
    return None


def append_kick(mounted, kick):
    if kick.strip() in mounted:  # a base that already carries it (the live version, re-seeded)
        return mounted
    return mounted.rstrip("\n") + "\n\n" + kick


def gr_form(rng):
    dev = json.load(open(GR_FORM[0], encoding="utf-8"))
    form = copy.deepcopy(dev)
    h = by_name(form)
    btn = find_model(form, "button_save_as_comp")
    func = switch_on(read(GRC), "ASYNC_COMPLETE_ENABLED")
    if "grc_onClick_completed" in h:  # the live base carries it: the repo mirror is the handler's source
        assert btn["events"]["onClick"] == h["grc_onClick_completed"]["key"], btn["events"]
        h["grc_onClick_completed"]["func"] = func
        return dev, form, {GRC: func}
    assert "onClick_workflowCompleted" in h
    assert btn["events"]["onClick"] == h["onClick_workflowCompleted"]["key"], btn["events"]
    key = new_key(form, rng)
    form["config"]["eventScript"].append({"key": key, "name": "grc_onClick_completed", "func": func, "type": "js"})
    btn["events"]["onClick"] = key
    return dev, form, {GRC: func}


def gr_list():
    dev = json.load(open(GR_LIST[0], encoding="utf-8"))
    page = copy.deepcopy(dev)
    h = by_name(page)
    func = switch_on(read(GRV), "ASYNC_REVERT_ENABLED")
    h["RevertCompletedGR"]["func"] = func
    h["mounted"]["func"] = append_kick(h["mounted"]["func"], read(GRV_KICK))
    return dev, page, {GRV: func}


def pw_form():
    dev = json.load(open(PW_FORM[0], encoding="utf-8"))
    form = copy.deepcopy(dev)
    e = by_name(form)["pwV2_onClick_completed"]
    # the base (live v366) is switched on already; the repo mirror is the handler's source from here on
    func = read(PWV)
    assert func.count("const ASYNC_PUTAWAY_ENABLED = true;") == 1
    for k, v in PW_IDS.items():
        assert func.count('%s: "%s", // PUTAWAY_ASYNC_%s' % (k, v, k)) == 1, k
    e["func"] = func
    return dev, form, {PWV: func}


def pw_list():
    dev = json.load(open(PW_LIST[0], encoding="utf-8"))
    page = copy.deepcopy(dev)
    h = by_name(page)
    h["mounted"]["func"] = append_kick(h["mounted"]["func"], read(PW_KICK))
    return dev, page, {}


def diffs(a, b, path="", out=None):
    out = [] if out is None else out
    if type(a) != type(b):
        out.append(path)
    elif isinstance(a, dict):
        for k in sorted(set(a) | set(b), key=str):
            if k not in a or k not in b:
                out.append(path + "/" + str(k))
            else:
                diffs(a[k], b[k], path + "/" + str(k), out)
    elif isinstance(a, list):
        if len(a) != len(b):
            out.append(path + " (length %d -> %d)" % (len(a), len(b)))
        for i, (x, y) in enumerate(zip(a, b)):
            diffs(x, y, path + "/" + str(i), out)
    elif a != b:
        out.append(path)
    return out


def main():
    rng = random.Random(20261015)
    write = "--write" in sys.argv
    for name, (dev, new, mirrors), out in (("GR form", gr_form(rng), GR_FORM[1]), ("GR list page", gr_list(), GR_LIST[1]),
                                            ("Putaway form", pw_form(), PW_FORM[1]), ("Putaway list page", pw_list(), PW_LIST[1])):
        print("== %s -> %s" % (name, os.path.relpath(out, ROOT)))
        for p in diffs(dev, new):
            print("   differs from dev:", p)
        if write:
            open(out, "w", encoding="utf-8").write(render(new, "indent"))
            for path, func in mirrors.items():
                open(path, "w", encoding="utf-8").write(func)
            print("   wrote", os.path.relpath(out, ROOT), "+", [os.path.relpath(p, ROOT) for p in mirrors])


main()
