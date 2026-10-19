"""patch_convert_switch.py [--write]: Convert to GD builds its lines through GD_STOCK_CHECK (gdV2_func_processGDLineItem).

- CONVERT_STOCK_CHECK_ENABLED: the form the SO list's Convert opens (page_status Add, the only Add trigger of this
  handler) takes the V2 path even while STOCK_CHECK_ENABLED is off; the Edit trigger (a Multiple-convert Draft reopened)
  keeps func_processGDLineItem.
- A failed stock check hands the original input to func_processGDLineItem (slower, complete) instead of building every
  line from empty facts.

Edits the GD form (Goods Delivery/GDfullJSON.json, text level: the file does not round-trip json.dumps) and the
handler's repo mirror (Goods Delivery/AsyncV2/gdV2_funcProcessGDLineItem.js) alike, then checks the form's handler
equals the mirror. Dry run unless --write."""
import json
import sys

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
FORM = R + "Goods Delivery/GDfullJSON.json"
MIRROR = R + "Goods Delivery/AsyncV2/gdV2_funcProcessGDLineItem.js"

EDITS = [
    (
        "const STOCK_CHECK_ENABLED = false;\n",
        "const STOCK_CHECK_ENABLED = false;\n"
        "// Convert to GD (the form opened in Add with the SO's lines) uses the stock check even while STOCK_CHECK_ENABLED is off\n"
        "const CONVERT_STOCK_CHECK_ENABLED = true;\n",
    ),
    (
        "  if (!GD_V2_WF.STOCK_CHECK || STOCK_CHECK_ENABLED !== true) {\n",
        '  const gdV2Convert = CONVERT_STOCK_CHECK_ENABLED === true && this.getValue("page_status") === "Add";\n'
        "  if (!GD_V2_WF.STOCK_CHECK || (STOCK_CHECK_ENABLED !== true && !gdV2Convert)) {\n",
    ),
    (
        '      console.error("GD V2 stock check failed:", failed);\n'
        '      this.$message.error("Stock check failed (" + failed + "): quantities are not suggested. Use Select Stock on each line.");\n'
        "      return gdV2FactsMaps(gdV2MergeFacts([]));\n",
        '      console.error("GD V2 stock check failed:", failed);\n'
        "      return Object.assign(gdV2FactsMaps(gdV2MergeFacts([])), { failed: failed });\n",
    ),
    (
        "  await gdV2LoadStockFacts(allItems, plant);\n"
        "  let newTableGd = await createTableGdWithBaseUOM(allItems);\n",
        "  if ((await gdV2LoadStockFacts(allItems, plant)).failed) {\n"
        '    console.log("GD V2: stock check failed; running func_processGDLineItem");\n'
        "    this.hideLoading();\n"
        '    await this.triggerEvent("func_processGDLineItem", arguments[0]);\n'
        "    return;\n"
        "  }\n"
        "  let newTableGd = await createTableGdWithBaseUOM(allItems);\n",
    ),
]


def find_ev(o):
    if isinstance(o, list):
        for x in o:
            r = find_ev(x)
            if r:
                return r
    elif isinstance(o, dict):
        if o.get("eventScript"):
            return o["eventScript"]
        for v in o.values():
            r = find_ev(v)
            if r:
                return r
    return None


def handler(text):
    return [e for e in find_ev(json.loads(text)) if e["name"] == "gdV2_func_processGDLineItem"][0]["func"]


def esc(s, ascii_only):
    return json.dumps(s, ensure_ascii=ascii_only)[1:-1]


form = open(FORM, encoding="utf8").read()
mirror = open(MIRROR, encoding="utf8").read()
assert handler(form) == mirror, "the form's handler and the repo mirror differ before the patch"

for old, new in EDITS:
    assert mirror.count(old) == 1, "mirror: patch point not unique: " + old[:70]
    mirror = mirror.replace(old, new)
    hits = [a for a in (False, True) if form.count(esc(old, a)) == 1]
    assert hits, "form: patch point not found once: " + old[:70]
    form = form.replace(esc(old, hits[0]), esc(new, hits[0]))

assert handler(form) == mirror, "after the patch the form's handler and the mirror differ"
json.loads(form)
print("4 edits apply once each; the form's handler equals the mirror (%d chars)" % len(mirror))
if "--write" in sys.argv:
    open(FORM, "w", encoding="utf8").write(form)
    open(MIRROR, "w", encoding="utf8").write(mirror)
    print("written:", FORM, MIRROR)
