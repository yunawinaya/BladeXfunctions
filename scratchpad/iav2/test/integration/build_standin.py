"""Integration (plan.md Task F): every Item Assembly V2 workflow built with STAND-IN shell ids, in memory only - ids.json is never
written: the builders' IDS dicts are patched inside this process. Prints ONE JSON object on stdout {standin, docs, checks} for
test/integration/e2e.js (build progress goes to stderr). Checks, each a hard failure:
  - every build equals the repo's "0"-id output once the stand-in ids are put back to "0" (the ids are the only difference);
  - the shell ids land where they belong: each worker calls its own PREPARE / COMMIT; the client ON build's form / list call
    their own SUBMIT / WORKER (completion vs revert never crossed); no "0" shell id is left in an ON build;
  - the generated worker JS (code/worker, code/revert/worker) is unchanged by the build.
usage: python3 scratchpad/iav2/test/integration/build_standin.py [--strict] > /dev/null   (e2e.js runs it itself; --strict: node
keys must match too)
       python3 scratchpad/iav2/test/integration/build_standin.py --zero   (the determinism proof: ids.json's own ids, one process,
       every one of the 10 workflows and D's form / list / mirrors / ON preview byte for byte = the repo files; prints a summary)
The builders' generated worker JS is compared, never written (their `open` is wrapped inside this process)."""
import contextlib
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
IAV2 = os.path.abspath(os.path.join(HERE, "..", ".."))
REPO = os.path.abspath(os.path.join(IAV2, "..", ".."))
OUT = os.path.join(REPO, "Item Assembly & BOM", "AsyncV2")
STANDIN = {
    "IA_V2_SUBMIT": "2199000000000000011", "IA_V2_WORKER": "2199000000000000012", "IA_V2_PREPARE": "2199000000000000013",
    "IA_V2_COMMIT": "2199000000000000014", "IA_REVERT_V2_SUBMIT": "2199000000000000021", "IA_REVERT_V2_WORKER": "2199000000000000022",
    "IA_REVERT_V2_PREPARE": "2199000000000000023", "IA_REVERT_V2_COMMIT": "2199000000000000024",
}
NAMES = ["IA_V2_PREPARE", "IA_V2_COMMIT", "IA_V2_WORKER", "IA_V2_SUBMIT", "IA_SAVE", "IA_REVERT_V2_PREPARE", "IA_REVERT_V2_COMMIT",
         "IA_REVERT_V2_WORKER", "IA_REVERT_V2_SUBMIT", "IA_REVERT"]
GEN = [os.path.join(IAV2, "code", "worker"), os.path.join(IAV2, "code", "revert", "worker")]
# IA_V2_SUBMIT's and IA_SAVE's repo files are frozen since 10-21: Small Cycle's patch_v4 / patch_v13 build the shipped SUBMIT / IA_SAVE
# from them (SmallCycle/), so a fresh build no longer equals them (10-22: IA_PREV_STATUSES gained Created; 10-27: the shared fingerprint.js
# gained the output split). The runs use the frozen files with their shell ids swapped for the stand-ins
FROZEN = ("IA_V2_SUBMIT", "IA_SAVE")
# Revert V2 builds that differ from their repo files (= DEV) only by shared code they never call (10-22 IA_PREV_STATUSES + Created; 10-27
# the output split in fingerprint.js: Revert V2 reads iaMovesFingerprint only): the runs use the repo files; every changed script line must
# be one of those, anything else fails. The drift ships with the next revert rebuild
DRIFT = ("IA_REVERT_V2_PREPARE", "IA_REVERT_V2_SUBMIT", "IA_REVERT_V2_COMMIT", "IA_REVERT_V2_WORKER")
DRIFT_LINE = re.compile(r"iaFp|IA_PREV_STATUSES = |// RES-01 Created \(BA, 10-22\)|// IA output split \(plan 10-27\): a split's rows|// so every other IA's fingerprint|^\};$"
                        r"|^  if \(typeof rows === \"string\"\) return rows;$|^  return split\.length \? base\.concat\(\[split\]\) : base;$")
ZERO = "--zero" in sys.argv
sys.path.insert(0, os.path.join(IAV2, "lib"))
sys.path.insert(0, IAV2)
sys.path.insert(0, os.path.join(IAV2, "client"))
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
sys.dont_write_bytecode = True
checks = []


def check(cond, what):
    if not cond:
        raise SystemExit("FAIL: " + what)
    checks.append(what)


GEN_DIFF = []


def guarded_open(path, mode="r", *args, **kw):
    """the generators' writes into code/worker or code/revert/worker are compared with the file instead of written"""
    if "w" in mode and any(os.path.abspath(path).startswith(d + os.sep) for d in GEN):
        class Cmp:
            def write(self, body):
                cur = open(path, encoding="utf-8").read() if os.path.exists(path) else None
                if cur != body:
                    GEN_DIFF.append(os.path.relpath(path, IAV2))
                return len(body)

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def close(self):
                pass
        return Cmp()
    return open(path, mode, *args, **kw)


def gen_md5():
    out = {}
    for d in GEN:
        for n in sorted(os.listdir(d)):
            out[os.path.join(d, n)] = hashlib.md5(open(os.path.join(d, n), "rb").read()).hexdigest()
    return out


def zeroed(text, ids=None):
    """the shell ids put back to "0": the stand-in ids of this build, or (ids) the real ones ids.json holds"""
    for v in (STANDIN if ids is None else ids).values():
        if v and v != "0":
            text = text.replace(v, "0")
    return text


def drift_lines(repo_doc, built_doc):
    """the script lines a build changed against the repo file, + every node whose non-script data changed"""
    import difflib
    out = []

    def walk(ns, acc):
        for n in ns or []:
            acc[n["id"]] = n
            walk(n.get("blocks"), acc)
    ra, rb = {}, {}
    walk(repo_doc["nodes"], ra)
    walk(built_doc["nodes"], rb)
    if sorted(ra) != sorted(rb):
        return ["node set: " + ", ".join(sorted(set(ra) ^ set(rb)))]
    for k in ra:
        da, db = ra[k].get("data") or {}, rb[k].get("data") or {}
        if json.dumps(da, sort_keys=True) == json.dumps(db, sort_keys=True):
            continue
        x, y = (da.get("script") or {}).get("code"), (db.get("script") or {}).get("code")
        rest = lambda d: json.dumps({kk: vv for kk, vv in d.items() if kk != "script"}, sort_keys=True)
        if x is None or y is None or rest(da) != rest(db):
            out.append(k + ": non-script data")
            continue
        out += [l[1:] for l in difflib.unified_diff(x.split("\n"), y.split("\n"), lineterm="", n=0) if l[:1] in "+-" and l[:3] not in ("+++", "---")]
    return out


def callees(doc):
    found = []

    def walk(ns):
        for n in ns or []:
            if n.get("type") == "workflow-node":
                found.append(n["data"]["workflow"]["source"])
            walk(n.get("blocks"))
    walk(doc["nodes"])
    return found


def zero(built):
    """ids.json's ids: every workflow and D's outputs as the builders make them in ONE process = the repo files, byte for byte"""
    check(sorted(built) == sorted(NAMES), "all 10 workflows built in one process (build_ia.builders(), publish order)")
    for name in NAMES:
        if name in FROZEN or name in DRIFT:
            continue
        text = json.dumps(built[name], ensure_ascii=False, indent=1) + "\n"
        repo = open(os.path.join(OUT, name + ".json"), encoding="utf-8").read()
        check(text == repo, "%s: byte for byte = the repo file (%d chars)" % (name, len(text)))
    with contextlib.redirect_stdout(sys.stderr):
        import build_client as BC
        off = BC.build(None)
        on = BC.build(set(BC.ACTIONS))
    wf, c, fa, fb, fm, added, la, lb, lm = off
    for fname, obj in (("IAform.json", fb), ("IAlistPage.json", lb)):
        check(BC.render(obj, "indent") == open(os.path.join(OUT, fname), encoding="utf-8").read(), "D " + fname + ": the OFF build = the repo file")
    for fname, txt in sorted(list(fm.items()) + list(lm.items())):
        check(txt == open(os.path.join(OUT, fname), encoding="utf-8").read(), "D mirror " + fname + " = the repo file")
    for fname, obj in (("IAform.json", on[3]), ("IAlistPage.json", on[7])):
        check(BC.render(obj, "indent") == open(os.path.join(IAV2, "client", "out", "on", fname), encoding="utf-8").read(), "D ON preview " + fname + " = client/out/on")
    print("\n".join("ok   " + x for x in checks))
    print("%d determinism checks passed" % len(checks))


def main():
    before = gen_md5()
    with contextlib.redirect_stdout(sys.stderr):
        import build_ia
        import v2build as V
        builders = build_ia.builders()
        for m in ("build_worker", "build_revert"):
            sys.modules[m].open = guarded_open
        patched = []
        if not ZERO:
            for name, mod in list(sys.modules.items()):
                ids = getattr(mod, "IDS", None)
                if isinstance(ids, dict) and "IA_V2_SUBMIT" in ids:
                    ids.update(STANDIN)
                    patched.append(name)
        built = V.build(builders, OUT, False)
    check(gen_md5() == before, "the build left code/worker and code/revert/worker unchanged")
    check(not GEN_DIFF, "the generated worker JS the builders produce = the files (%s)" % (", ".join(GEN_DIFF) or "all equal"))
    if ZERO:
        return zero(built)
    check(sorted(built) == sorted(NAMES), "all 10 workflows built: " + ", ".join(NAMES))
    for v in STANDIN.values():
        check(all(v not in open(os.path.join(OUT, n + ".json"), encoding="utf-8").read() for n in NAMES), "stand-in id " + v + " is not a real id in the repo")
    warnings = []
    real = {k: str(json.load(open(os.path.join(IAV2, "ids.json"), encoding="utf-8"))[k]) for k in STANDIN}
    for name in FROZEN:
        text = open(os.path.join(OUT, name + ".json"), encoding="utf-8").read()
        for k, v in real.items():
            if v and v != "0":
                text = text.replace(v, STANDIN[k])
        built[name] = json.loads(text)
        checks.append(name + ": the frozen repo file (Small Cycle's base), its shell ids swapped for the stand-ins")
    for name in DRIFT:
        raw = open(os.path.join(OUT, name + ".json"), encoding="utf-8").read()
        bad = [l for l in drift_lines(json.loads(zeroed(raw, real)), json.loads(zeroed(json.dumps(built[name], ensure_ascii=False)))) if not DRIFT_LINE.search(l)]
        check(not bad, name + ": the build differs from the repo file only by the declared shared drift" + ("" if not bad else " - not: " + " | ".join(bad[:5])))
        for k, v in real.items():
            if v and v != "0":
                raw = raw.replace(v, STANDIN[k])
        built[name] = json.loads(raw)
        warnings.append(name + ": the repo file (= DEV) runs; the build adds only the declared shared drift")
    for name in NAMES:
        if name in FROZEN:
            continue
        text = json.dumps(built[name], ensure_ascii=False, indent=1) + "\n"
        repo = zeroed(open(os.path.join(OUT, name + ".json"), encoding="utf-8").read(), real)
        if zeroed(text) == repo:
            checks.append(name + ": the stand-in build == the repo output, both with their shell ids put back to \"0\"")
            continue
        # wfkit's node keys come from one process-wide RNG + taken set: a builder reseeded like another builder redraws them
        nokeys = lambda t: re.sub(r'"key": "[0-9a-z]{8}"', '"key": "-"', t)
        check(nokeys(zeroed(text)) == nokeys(repo) and "--strict" not in sys.argv, name + ": the stand-in build == the repo output (ids put back to \"0\")")
        warnings.append(name + ": equal to the repo output except its wfkit node keys (built in one process after the other packages)")
    want = {"IA_V2_WORKER": ["IA_V2_PREPARE", "IA_V2_COMMIT"], "IA_REVERT_V2_WORKER": ["IA_REVERT_V2_PREPARE", "IA_REVERT_V2_COMMIT"]}
    for w, targets in want.items():
        got = sorted(set(callees(built[w])))
        check(got == sorted("%s:Workflow:%s" % (t, STANDIN[t]) for t in targets), w + " calls " + " / ".join(targets) + " by their own ids: " + ", ".join(got))
    for name in NAMES:
        if name in want:
            continue
        shells = [c for c in callees(built[name]) if c.split(":Workflow:")[0] in STANDIN]
        check(not shells, name + " calls no V2 shell")

    # the client ON build with the same ids, in memory (build_client.build() writes nothing)
    with contextlib.redirect_stdout(sys.stderr):
        import build_client as BC
        BC.ids = lambda: {k: STANDIN[k] for k in ("IA_V2_SUBMIT", "IA_V2_WORKER", "IA_REVERT_V2_SUBMIT", "IA_REVERT_V2_WORKER")}
        wf, c, fa, fb, fm, added, la, lb, lm = BC.build(set(BC.ACTIONS))
    mirrors = dict(fm)
    mirrors.update(lm)
    S, W, RS, RW = (STANDIN[k] for k in ("IA_V2_SUBMIT", "IA_V2_WORKER", "IA_REVERT_V2_SUBMIT", "IA_REVERT_V2_WORKER"))

    def consts(text, obj):
        m = re.search(r"const %s = \{(.*?)\};" % obj, text, re.S)
        return dict(re.findall(r"(\w+): \"([0-9]+)\"", m.group(1))) if m else {}
    for f in ("iaV2_onClick_completed.js", "iaV2_onClick_completed_post.js"):
        txt = mirrors[f]
        # ruling 10 R9: the revert ids gate the route (iaOn), the calls go to the completion's SUBMIT / WORKER only
        check(consts(txt, "IA_WF") == {"SUBMIT": S, "WORKER": W, "REVERT_SUBMIT": RS, "REVERT_WORKER": RW}, f + ": IA_WF = the completion's SUBMIT / WORKER + the revert pair (R9 gate)")
        called = set(re.findall(r"(?:run|runWorkflow)\(IA_WF\.(\w+)", txt))
        check(called == {"SUBMIT", "WORKER"} and "IA_WF.REVERT_SUBMIT, IA_WF.REVERT_WORKER].every(" in txt, f + ": calls only IA_WF.SUBMIT / WORKER; the revert ids only gate iaOn")
    check(consts(mirrors["iaForm_mounted.js"], "IA_BG_WF") == {"SUBMIT": S, "WORKER": W, "REVERT_SUBMIT": RS, "REVERT_WORKER": RW},
          "iaForm_mounted.js: IA_BG_WF = the completion's and the revert's SUBMIT / WORKER")
    rv = consts(mirrors["iaList_IArevertCompleted.js"], "IARV_WF")
    check(rv == {"SUBMIT": RS, "WORKER": RW}, "iaList_IArevertCompleted.js: IARV_WF = { SUBMIT: IA_REVERT_V2_SUBMIT, WORKER: IA_REVERT_V2_WORKER }")
    ids_json = json.load(open(os.path.join(IAV2, "ids.json"), encoding="utf-8"))
    check('const IA_REVERT_WORKFLOW_ID = "%s";' % ids_json["IA_REVERT"] in mirrors["iaList_IArevertCompleted.js"],
          "iaList_IArevertCompleted.js: the classic fallback stays IA_REVERT " + ids_json["IA_REVERT"])
    km = mirrors["iaList_mounted.js"]
    check(S not in km and RS not in km and W in km and RW in km, "iaList_mounted.js kicks IA_V2_WORKER and IA_REVERT_V2_WORKER (no SUBMIT)")
    for f, text in sorted(mirrors.items()):
        check(not re.search(r'(SUBMIT|WORKER)\w*: "0"', text) and "__IA_" not in text, f + ": no \"0\" shell id or placeholder left in the ON build")
    sys.stdout.write(json.dumps({"standin": STANDIN, "docs": built, "checks": checks, "warnings": warnings, "patched": patched}, ensure_ascii=False))


if __name__ == "__main__":
    main()
