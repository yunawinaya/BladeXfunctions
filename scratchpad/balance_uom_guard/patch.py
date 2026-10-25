"""patch.py [--write] [<in.json> [<out.json>]]: BALANCE_UOM_CONVERSION - the four request inputs reach sql_node_Qb7hK2Rx only
through code_node_BUguard (digit ids or fixed words), never as caller text (security review 2026-10-24). The SQL keeps its
quoting; only the placeholders change. Default: the repo file, previewed (--write saves it in its own 2-space format)."""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
DEFAULT = os.path.join(REPO, "Balance Table", "BalanceUOMConversionWorkflow.json")
PARAMS = ["material_id", "material_uom", "balance_type", "selected_dept_id"]
KEYS = {"material_id": "bugd1mat", "material_uom": "bugd2uom", "balance_type": "bugd3bty", "selected_dept_id": "bugd4dep"}
GUARD_ID = "code_node_BUguard"
SQL_ID = "sql_node_Qb7hK2Rx"
TITLE = "Guard: the inputs as digit ids / fixed words only (no caller text reaches the SQL)"


def patch(doc):
    nodes = doc["nodes"]
    if any(n.get("id") == GUARD_ID for n in nodes):
        raise SystemExit("already patched")
    at = next(i for i, n in enumerate(nodes) if n.get("id") == SQL_ID)
    script = nodes[at]["data"]["script"]
    code = script["code"]
    for p in PARAMS:
        code = code.replace("{{workflowparams:%s}}" % p, "{{node:%s.data.%s}}" % (GUARD_ID, p))
    assert "{{workflowparams:" not in code, "an input placeholder is left in the SQL"
    script["code"] = code
    guard = {"id": GUARD_ID, "type": "code-node", "data": {
        "language": "javascript", "code": "", "timeout": 30000,
        "script": {"type": "javascript", "code": open(os.path.join(HERE, "guard.js"), encoding="utf-8").read().rstrip("\n")},
        "response_json": [{"key": KEYS[p], "name": p, "title": p, "description": "", "bsonType": "string", "isExpand": False, "children": []} for p in PARAMS],
        "title": TITLE, "isValidator": True, "nodeName": TITLE, "name": TITLE}, "blocks": []}
    nodes.insert(at, guard)
    return doc


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    src = args[0] if args else DEFAULT
    dst = args[1] if len(args) > 1 else src
    raw = open(src, encoding="utf-8").read()
    pretty = raw.lstrip().startswith("{\n")
    doc = patch(json.loads(raw))
    text = json.dumps(doc, indent=2, ensure_ascii=False) + "\n" if pretty else json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
    print("%s -> %s: guard inserted before %s, %d placeholder(s) rewritten" % (os.path.basename(src), os.path.basename(dst), SQL_ID, raw.count("{{workflowparams:")))
    if "--write" in sys.argv:
        open(dst, "w", encoding="utf-8").write(text)
        print("written")
    else:
        print("(preview: --write to save)")
