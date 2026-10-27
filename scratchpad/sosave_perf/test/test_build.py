"""build.py in a scratch copy of scratchpad/sosave_perf: it rebuilds out/ exactly, and it refuses a trim that drops a used
helper or a live COMMIT lookup that no longer is the text the rewrite replaces.

usage: python3 scratchpad/sosave_perf/test/test_build.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
fails = 0


def check(name, ok, detail=""):
    global fails
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "\n     " + detail[-1200:]))
    fails += 0 if ok else 1


def copy():
    tmp = os.path.join(tempfile.mkdtemp(prefix="sosave-build-"), "sosave_perf")
    shutil.copytree(ROOT, tmp, ignore=shutil.ignore_patterns("node_modules", "out", "__pycache__"))
    os.symlink(os.path.join(ROOT, "node_modules"), os.path.join(tmp, "node_modules"))
    return tmp


def build(tmp):
    r = subprocess.run([sys.executable, os.path.join(tmp, "build.py")], capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


def patch(path, old, new):
    text = open(path).read()
    if text.count(old) != 1:
        raise SystemExit(f"test anchor found {text.count(old)} times in {path}: {old[:80]!r}")
    open(path, "w").write(text.replace(old, new))


def same_files(a, b):
    names = sorted(n for n in os.listdir(b) if n.endswith(".json"))
    return names == sorted(n for n in os.listdir(a) if n.endswith(".json")) and all(
        open(os.path.join(a, n), "rb").read() == open(os.path.join(b, n), "rb").read() for n in names)


# 1. the unchanged sources rebuild out/ byte for byte
tmp = copy()
code, log = build(tmp)
check("a clean copy builds", code == 0, log)
check("its out/ and out/preshake/ are the published out/, byte for byte",
      code == 0 and same_files(os.path.join(tmp, "out"), os.path.join(ROOT, "out"))
      and same_files(os.path.join(tmp, "out", "preshake"), os.path.join(ROOT, "out", "preshake")), log)

# 2. a trim that drops a helper the kept code still calls: the build stops
tmp = copy()
patch(os.path.join(tmp, "shake.mjs"), "    if (keep[i]) out += swapped.slice(prevEnd, st.end);",
      "    if (keep[i] && !/^const num = /.test(swapped.slice(st.start, st.end))) out += swapped.slice(prevEnd, st.end);")
code, log = build(tmp)
check("a trim that drops the used helper num is refused", code != 0 and "dropped but used" in log and '"num"' in log, log)

# 3. a live sql_node_SCfind that is not the text the rewrite replaces: the build stops
tmp = copy()
base = os.path.join(tmp, "base", "SO_SAVE_COMMIT.v10.json")
doc = json.load(open(base))
def walk(nodes):
    for n in nodes:
        yield n
        yield from walk(n.get("blocks") or [])
node = next(n for n in walk(doc["nodes"]) if n["id"] == "sql_node_SCfind")
sql = node["data"]["script"]["code"]
if sql.count("   AND s.is_deleted = 0\n") != 1:
    raise SystemExit("test anchor not found in the base sql_node_SCfind")
node["data"]["script"]["code"] = sql.replace("   AND s.is_deleted = 0\n", "   AND s.is_deleted = 0\n   AND s.so_no <> ''\n")
json.dump(doc, open(base, "w"), ensure_ascii=False, separators=(",", ":"))
code, log = build(tmp)
check("a live sql_node_SCfind with one more condition is refused", code != 0 and "sql_node_SCfind" in log, log)

print("all passed" if not fails else f"{fails} FAILED")
raise SystemExit(1 if fails else 0)
