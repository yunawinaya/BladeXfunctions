"""The pinned deployed versions of lift/nodes.json, fetched read-only from dev into the session scratchpad (workflow
sources stay out of the repo). usage: python3 src.py -> prints one '<name> <path>' line per source."""
import json, os, sys

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, R + "scratchpad/gdc/pkv2tools")
from dbq import q  # noqa: E402

CACHE = os.environ.get("GDREV_SRC") or "/private/tmp/claude-501/-Users-yunawinaya-Developer-BladeXfunctions/15e6fc61-e726-4d06-9ece-6e8ec1b9d6be/scratchpad/gdrev-src"


def fetch(src):
    path = os.path.join(CACHE, "%s.v%d.json" % (src["name"], src["version"]))
    if not os.path.exists(path):
        rows = q("--dev", "SELECT script_json FROM su_code_workflow_history WHERE data_id = %s AND version_number = %d AND status IN ('enabled', 'history') ORDER BY id DESC LIMIT 1" % (src["workflow_id"], src["version"]))
        if not rows:
            sys.exit("%s v%d not found on dev" % (src["name"], src["version"]))
        os.makedirs(CACHE, exist_ok=True)
        open(path, "w", encoding="utf-8").write(rows[0]["script_json"])
    return path


if __name__ == "__main__":
    for s in json.load(open(os.path.join(HERE, "nodes.json")))["sources"]:
        print(s["name"], fetch(s))
