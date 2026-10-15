"""render(obj, "min"): the workflow recipe (Prettier --parser json over compact JSON); "indent": the form recipe."""
import json, os, subprocess

PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")


def render(obj, mode="min"):
    src = json.dumps(obj, ensure_ascii=False, separators=(",", ":")) if mode == "min" else json.dumps(obj, ensure_ascii=False, indent=2)
    r = subprocess.run(["node", PRETTIER, "--parser", "json"], input=src, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(r.stderr[:400])
    return r.stdout
