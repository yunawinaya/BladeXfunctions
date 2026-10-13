#!/usr/bin/env python3
"""Step 3 of the LSH plan: SO -> GD in bulk survives a changed Sales Order and big batches.

1. GOODS_DELIVERY code_node_QtyCheckBatch threw "sales order line ... was not found" when an SO line
   was deleted after the convert read it. A throw ends the caller's whole run, so SO_AUTO_GD lost the
   rest of a 250-SO batch (2026-10-13). It now returns soLineMissing + a message, and a new
   if_SoLineGone returns 400 with it -- before any write, like the item-not-found case beside it.
   Dev (v239) and prod (v174) differ elsewhere, so each is built on its own enabled version:
   dev -> Goods Delivery/GDheadWorkflow.json, prod -> Goods Delivery/GDheadWorkflow.PROD.json.
2. SO_AUTO_GD sql_node_Items: no LIMIT 500 (above 500 distinct items the rest silently went missing).
   Dev and prod run the same v16, so one file: Goods Delivery/SOconvertGDCreatedWorkflow.json.

usage: python3 build_so_to_gd.py [--write]
"""
import copy, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_picking as bp  # noqa: E402  locate/node/replace_code/Ids/resp/flag_if/render_onto/canon

REPO = bp.REPO
GD_DEV = os.path.join(REPO, "Goods Delivery", "GDheadWorkflow.json")
GD_PROD = os.path.join(REPO, "Goods Delivery", "GDheadWorkflow.PROD.json")
SO_AUTO_GD = os.path.join(REPO, "Goods Delivery", "SOconvertGDCreatedWorkflow.json")
GD_ID, SO_AUTO_GD_ID = 2017151544868491265, 2076557490389835777


def enabled(env, wf_id):
    out = subprocess.run([os.path.join(REPO, ".dbtools", "db"), env, "--json",
                          f"SELECT version_number, script_json FROM su_code_workflow_history WHERE data_id={wf_id} "
                          "AND status='enabled' ORDER BY version_number DESC LIMIT 1"], capture_output=True, text=True)
    if out.returncode:
        raise SystemExit(out.stderr[-400:])
    row = json.loads(out.stdout)[0]
    return row["version_number"], json.loads(row["script_json"])


QTY_DECL_OLD = "let itemNotFound = 0;\n"
QTY_DECL_NEW = "let itemNotFound = 0;\nlet soLineMissing = 0;\nlet soLineMissingMessage = \"\";\n"
QTY_THROW_OLD = """  if (!soItem) {
    throw new Error("Row " + rowIndex + ": sales order line " + gdItem.so_line_item_id + " was not found.");
  }
"""
QTY_THROW_NEW = """  if (!soItem) {
    // Returned, not thrown: a throw ends the caller's whole run, and SO_AUTO_GD converts a batch of SOs in one run.
    soLineMissing = 1;
    soLineMissingMessage = "Row " + rowIndex + " (" + (itemData.material_code || gdItem.material_name || gdItem.gd_material_desc || "item") +
      "): its sales order line no longer exists. The Sales Order was changed after this delivery was prepared; reload it and try again.";
    break;
  }
"""
QTY_RET_OLD = "  itemNotFound: itemNotFound\n};"
QTY_RET_NEW = ("  itemNotFound: itemNotFound,\n  soLineMissing: soLineMissing,\n"
               "  soLineMissingMessage: soLineMissingMessage\n};")


def patch_gd(base):
    wf = copy.deepcopy(base)
    ids = bp.Ids(wf)
    bp.replace_code(wf, "code_node_QtyCheckBatch", QTY_DECL_OLD, QTY_DECL_NEW)
    bp.replace_code(wf, "code_node_QtyCheckBatch", QTY_THROW_OLD, QTY_THROW_NEW)
    bp.replace_code(wf, "code_node_QtyCheckBatch", QTY_RET_OLD, QTY_RET_NEW)
    qty = bp.node(wf, "code_node_QtyCheckBatch")
    assert [r["name"] for r in qty["data"]["response_json"]] == ["validationMessage", "updatedSOTable", "itemNotFound"]
    qty["data"]["response_json"] += [bp.resp(ids, "soLineMissing", "int"), bp.resp(ids, "soLineMissingMessage", "string")]

    ret = copy.deepcopy(bp.node(wf, "return_node_78ucW0dY"))
    ret["id"] = "return_node_SoLineGone"
    code, message = ret["data"]["response_value"]["list"]
    assert (code["prop"], code["value"], message["prop"]) == ("code", "400", "message")
    message.update(valueType="field", value="{{node:code_node_QtyCheckBatch.data.soLineMissingMessage}}")
    lst, i = bp.locate(wf, "if_9DC5Lah8")
    assert lst[i + 1]["id"] == "if_ACsN1GZD"
    lst.insert(i + 1, bp.flag_if(ids, "if_SoLineGone", "IF Sales Order Line Gone",
                                 "node.code_node_QtyCheckBatch.data.soLineMissing", [ret]))
    return wf


ITEMS_LIMIT_OLD = ") pk ON pk.iid = i.id\nLIMIT 500"
ITEMS_LIMIT_NEW = ") pk ON pk.iid = i.id"


def patch_so_auto_gd_text(raw):
    """Only the item query changes, so the file's own text is edited and its layout kept."""
    wf = json.loads(raw)
    code = bp.node(wf, "sql_node_Items")["data"]["script"]["code"]
    assert code.count(ITEMS_LIMIT_OLD) == 1
    old, new = json.dumps(code, ensure_ascii=False), json.dumps(code.replace(ITEMS_LIMIT_OLD, ITEMS_LIMIT_NEW),
                                                                ensure_ascii=False)
    assert raw.count(old) == 1, "the item query is not stored as one plain JSON string"
    out = raw.replace(old, new)
    target = json.loads(out)
    assert bp.node(target, "sql_node_Items")["data"]["script"]["code"].endswith(ITEMS_LIMIT_NEW)
    return out, target


def main(write):
    dev_v, dev = enabled("--dev", GD_ID)
    prod_v, prod = enabled("--prod", GD_ID)
    raw_dev = open(GD_DEV, encoding="utf-8").read()
    assert bp.canon(json.loads(raw_dev)) == bp.canon(dev), f"repo GDheadWorkflow.json is not dev's enabled v{dev_v}"
    a = bp.node(dev, "code_node_QtyCheckBatch")["data"]["script"]["code"]
    assert a == bp.node(prod, "code_node_QtyCheckBatch")["data"]["script"]["code"], "QtyCheckBatch differs dev/prod"
    print(f"GOODS_DELIVERY: dev v{dev_v} (= repo file), prod v{prod_v}")
    dev_new, prod_new = patch_gd(dev), patch_gd(prod)
    dev_text = bp.render_onto(raw_dev, dev, dev_new, normalize=())
    prod_text = bp.sr.render(prod_new).rstrip("\n")

    so_dev_v, so_dev = enabled("--dev", SO_AUTO_GD_ID)
    so_prod_v, so_prod = enabled("--prod", SO_AUTO_GD_ID)
    raw_so = open(SO_AUTO_GD, encoding="utf-8").read()
    assert bp.canon(json.loads(raw_so)) == bp.canon(so_dev) == bp.canon(so_prod), "SO_AUTO_GD: repo, dev and prod differ"
    so_text, so_new = patch_so_auto_gd_text(raw_so)
    print(f"SO_AUTO_GD: dev v{so_dev_v} = prod v{so_prod_v} = repo file")

    outputs = [(GD_DEV, dev_text), (GD_PROD, prod_text), (SO_AUTO_GD, so_text)]
    if write:
        for path, text in outputs:
            open(path, "w", encoding="utf-8").write(text)
            print("wrote", os.path.relpath(path, REPO))
    else:
        tmp = os.environ.get("TMPDIR", "/tmp")
        for path, text in outputs:
            out = os.path.join(tmp, os.path.basename(path).replace(".json", ".built.json"))
            open(out, "w", encoding="utf-8").write(text)
            print("dry run, wrote", out)
    return dev_new, prod_new, so_new


if __name__ == "__main__":
    main("--write" in sys.argv)
