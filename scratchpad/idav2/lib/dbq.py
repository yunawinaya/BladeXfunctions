"""q(env, sql) -> rows (list of dicts) through the read-only .dbtools/db helper."""
import json, subprocess

DB = "/Users/yunawinaya/Developer/BladeXfunctions/.dbtools/db"


def q(env, sql, limit=200000):
    r = subprocess.run([DB, env, "--json", "--limit", str(limit), sql], capture_output=True, text=True)
    out = r.stdout
    i = out.find("\n[")
    if i < 0:
        i = out.find("[")
        if i < 0 or out.lstrip().startswith("[DEV]") and "\n" not in out.strip():
            raise RuntimeError((out + r.stderr).strip()[:600])
    try:
        return json.loads(out[i:])
    except ValueError:
        raise RuntimeError((out + r.stderr).strip()[:600])
