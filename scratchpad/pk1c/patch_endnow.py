"""patch_endnow.py [--write]: finished_at = the run's real end in Picking V2's PREPARE and COMMIT (bladexfunctions-a6's
recipe, 2026-10-16). Each run's entry also returns jsAt (its Date.now()); every end stamp becomes endNow(entry) = the DB
clock read at entry + the whole seconds the run has taken since (dbNow when jsAt is missing). The same text change goes
into the 1c sources (scratchpad/pk1c/code) and the JSON nodes built from them, asserted equal before and after.
Prints what changes; writes only with --write.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from patch_pkv2 import R, HERE, fmt, field  # noqa: E402

DBADD = """const dbAddSeconds = function dbAddSeconds(text, seconds) {
  const m = String(text || "").match(/^(\\d{4})-(\\d{2})-(\\d{2}) (\\d{2}):(\\d{2}):(\\d{2})/);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) + seconds * 1000);
  const p = (n) => (n < 10 ? "0" : "") + n;
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
};
"""
ENDNOW = """// finished_at = the run's real end: the DB clock read at entry + the seconds since (jsAt = the entry's Date.now())
const endNow = (entry) => (Number(entry.jsAt) > 0 ? dbAddSeconds(entry.dbNow, Math.max(0, Math.floor((Date.now() - Number(entry.jsAt)) / 1000))) : "") || entry.dbNow;
"""
STAMPS = [("finished_at: entry.dbNow", "finished_at: endNow(entry)"), ("finished_at: s(entry.dbNow) || null", "finished_at: s(endNow(entry)) || null")]


def end_now(text):
    """endNow (and dbAddSeconds when the code has none) + every end stamp through it; unchanged when nothing stamps."""
    n = sum(text.count(a) for a, _ in STAMPS)
    if not n:
        return text, 0
    if "const dbAddSeconds = function dbAddSeconds(" in text:
        assert text.count(DBADD) == 1, "a dbAddSeconds other than the shared one"
        text = text.replace(DBADD, DBADD + ENDNOW)
    else:
        m = re.search(r"^const ", text, re.M)
        text = text[:m.start()] + DBADD + ENDNOW + text[m.start():]
    for a, b in STAMPS:
        text = text.replace(a, b)
    return text, n


def code_nodes(lst, out):
    for n in lst or []:
        if n.get("type") == "code-node":
            out.append(n)
        code_nodes(n.get("blocks"), out)
    return out


def src(name):
    return open(os.path.join(HERE, "code", name), encoding="utf-8").read()


def entry_jsat(text, anchor, insert):
    assert text.count(anchor) == 1, "entry anchor: " + anchor
    return text.replace(anchor, anchor + insert)


SOURCES = {}


def source(name, text):
    SOURCES[name] = text
    return text


def patch(doc, which):
    nodes = code_nodes(doc["nodes"], [])
    by = {n["id"]: n for n in nodes}
    report = []
    if which == "COMMIT":
        common_old = src("commit_pm_common.js")
        assert by["code_node_PCentry"]["data"]["script"]["code"] == src("commit_entry.js"), "PCentry is not commit_entry.js"
        ent = source("commit_entry.js", entry_jsat(src("commit_entry.js"), "dbNow: dbNow,", " jsAt: String(Date.now()),"))
        by["code_node_PCentry"]["data"]["script"]["code"] = ent
        by["code_node_PCentry"]["data"]["response_json"].append(field("jsatpcen", "jsAt", "jsAt"))
        report.append("code_node_PCentry +jsAt")
        common_new = source("commit_pm_common.js", end_now(common_old)[0])
        source("commit_pm1check.js", src("commit_pm1check.js").replace("finished_at: entry.dbNow", "finished_at: endNow(entry)"))
        for n in nodes:
            if n["id"] == "code_node_PCentry":
                continue
            old = n["data"]["script"]["code"]
            new, k = end_now(old)
            if k:
                if old.startswith(common_old + "\n"):
                    assert new.startswith(common_new + "\n"), n["id"] + ": the shared PM helpers differ from commit_pm_common.js"
                n["data"]["script"]["code"] = new
                report.append("%s %d" % (n["id"], k))
    else:
        pp = by["code_node_PPentry"]["data"]["script"]["code"]
        by["code_node_PPentry"]["data"]["script"]["code"] = entry_jsat(pp, "dbNow: s(job.db_now)", ", jsAt: String(Date.now())")
        by["code_node_PPentry"]["data"]["response_json"].append(field("jsatppen", "jsAt", "jsAt"))
        report.append("code_node_PPentry +jsAt")
        for nid, name in (("code_node_PPplan", "prepare_plan.js"), ("code_node_PPfinal", "prepare_final.js")):
            assert by[nid]["data"]["script"]["code"] == src(name), nid + " is not " + name
            new, k = end_now(src(name))
            if nid == "code_node_PPfinal":
                new = entry_jsat(new, "dbNow: [{{node:code_node_PPentry.data.dbNow}}][0]", ", jsAt: [{{node:code_node_PPentry.data.jsAt}}][0]")
            by[nid]["data"]["script"]["code"] = source(name, new)
            report.append("%s %d" % (nid, k))
        rest = [n["id"] for n in nodes if n["id"] not in ("code_node_PPplan", "code_node_PPfinal") and end_now(n["data"]["script"]["code"])[1]]
        assert not rest, "other PREPARE stamps: %s" % rest
    left = [n["id"] for n in nodes if "finished_at: entry.dbNow" in n["data"]["script"]["code"] or "s(entry.dbNow) || null" in n["data"]["script"]["code"]]
    assert not left, "stamps left: %s" % left
    return report


FILES = {"PREPARE": "Picking/AsyncV2/PICKING_BULK_PREPARE.json", "COMMIT": "Picking/AsyncV2/PICKING_BULK_COMMIT.json"}

if __name__ == "__main__":
    write = "--write" in sys.argv
    outs = {}
    for name, path in FILES.items():
        raw = open(R + path, encoding="utf-8").read()
        doc = json.loads(raw)
        assert fmt(doc) == raw, path + ": the printer does not round-trip the file"
        print(name, "->", ", ".join(patch(doc, name)))
        outs[path] = fmt(doc)
    print("sources ->", ", ".join(sorted(SOURCES)))
    if write:
        for path, out in outs.items():
            open(R + path, "w", encoding="utf-8").write(out)
        for name, text in SOURCES.items():
            open(os.path.join(HERE, "code", name), "w", encoding="utf-8").write(text)
    print("written" if write else "dry run (--write to save)")
