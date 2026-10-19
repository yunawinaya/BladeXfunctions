"""Offline tests of the custom-field keep chain as built (out/<NAME>.json): the three code nodes run in node with their
placeholders substituted, for header-only and header + lines workflows.   python3 test_cf.py"""
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from patch_cf import nodes_of  # noqa: E402

PH = re.compile(r"\{\{([^}]+)\}\}")
fails = 0


def body(doc, nid):
    return nodes_of(doc)[nid][0]["data"]["script"]["code"]


def run(code, values, absent="null"):
    def rep(m):
        k = m.group(1)
        return json.dumps(values[k], ensure_ascii=False) if k in values else absent
    src = "const __f = () => {\n" + PH.sub(rep, code) + "\n};\nprocess.stdout.write(JSON.stringify(__f()));"
    r = subprocess.run(["node", "-e", src], capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(r.stderr[:600])
    return json.loads(r.stdout)


def expect(label, got, want):
    global fails
    bad = {k: (got.get(k), v) for k, v in want.items() if got.get(k) != v}
    print(("ok   " if not bad else "FAIL ") + label + ("" if not bad else "  " + json.dumps(bad, ensure_ascii=False)[:400]))
    fails += 1 if bad else 0


def chain(doc, n, values, stored, absent="null"):
    need = run(body(doc, "code_node_CfNeed%d" % n), values, absent)
    v = dict(values)
    v["node:code_node_CfNeed%d.data.need" % n] = need["need"]
    if need["need"] == "YES":
        v["node:get_node_CfStored%d.data.data" % n] = stored
        v["node:code_node_CfFill%d.data" % n] = run(body(doc, "code_node_CfFill%d" % n), v, absent)
    return need, run(body(doc, "code_node_CfOut%d" % n), v, absent)


for absent in ("null", ""):
    tag = " [absent -> %s]" % (absent or "empty")
    # ---------------- header only: CUSTOMER_SAVE
    doc = json.load(open(os.path.join(HERE, "out", "CUSTOMER_SAVE.json")))
    E, K = "node:code_fillback.data.entry", "custom_fields_5v598pdl"
    stored = {"id": "77", K: {"tier": "gold"}}
    need, out = chain(doc, 1, {E + ".id": "77", E + "." + K: {"tier": "silver"}}, stored, absent)
    expect("customer web edit with the key -> no read, writes the sent value" + tag, {**need, **out}, {"need": "NO", "cf": {"tier": "silver"}})
    need, out = chain(doc, 1, {E + ".id": "77", E + "." + K: {}}, stored, absent)
    expect("customer edit clearing the fields ({}) -> written as {}" + tag, {**need, **out}, {"need": "NO", "cf": {}})
    need, out = chain(doc, 1, {E + ".id": "77"}, stored, absent)
    expect("customer edit without the key -> stored value kept" + tag, {**need, **out}, {"need": "YES", "cf": {"tier": "gold"}})
    need, out = chain(doc, 1, {E + ".id": "77"}, [stored], absent)
    expect("  ... get node answering an array" + tag, {**need, **out}, {"need": "YES", "cf": {"tier": "gold"}})
    need, out = chain(doc, 1, {E + ".id": "77"}, {"id": "77"}, absent)
    expect("customer edit without the key, nothing stored -> null (as before)" + tag, {**need, **out}, {"need": "YES", "cf": None})
    need, out = chain(doc, 1, {E + ".id": ""}, stored, absent)
    expect("no record id -> no read" + tag, need, {"need": "NO"})

    # ---------------- header + lines with a natural key: GOODS_RECEIVING update_node_bUR4vc0L (chain 2)
    doc = json.load(open(os.path.join(HERE, "out", "GOODS_RECEIVING.json")))
    A, H, L = "node:code_node_4r2Fv9G5.data.allData", "custom_fields_e9609s2l", "custom_fields_d7o7rdkd"
    stored = {"id": "900", H: {"dock": "D4"}, "table_gr": [
        {"id": "1", "po_line_item_id": "P1", L: {"lot": "a"}},
        {"id": "2", "po_line_item_id": "P2", L: {"lot": "b"}},
        {"id": "3", "po_line_item_id": "P2", L: {"lot": "c"}},
        {"id": "4", "po_line_item_id": "P3", L: None, "children": [{"id": "5", "po_line_item_id": "P4", L: {"lot": "e"}}]},
    ]}
    web = [{"id": "1", "po_line_item_id": "P1", L: {"lot": "A2"}}, {"id": "2", "po_line_item_id": "P2", L: {}}]
    need, out = chain(doc, 2, {A + ".id": "900", A + "." + H: {"dock": "D9"}, A + ".table_gr": web}, stored, absent)
    expect("GR web edit (keys sent) -> no read, payload written" + tag, {**need, **out}, {"need": "NO", "cf": {"dock": "D9"}, "lines": web})
    mobile = [{"po_line_item_id": "P2", "received_qty": 1}, {"po_line_item_id": "P1", "received_qty": 2},
              {"po_line_item_id": "P2", "received_qty": 3}, {"po_line_item_id": "P3", "received_qty": 4},
              {"po_line_item_id": "P9", "received_qty": 5}]
    need, out = chain(doc, 2, {A + ".id": "900", A + ".table_gr": mobile}, stored, absent)
    want_lines = [{"po_line_item_id": "P2", "received_qty": 1, L: {"lot": "b"}}, {"po_line_item_id": "P1", "received_qty": 2, L: {"lot": "a"}},
                  {"po_line_item_id": "P2", "received_qty": 3, L: {"lot": "c"}}, {"po_line_item_id": "P3", "received_qty": 4},
                  {"po_line_item_id": "P9", "received_qty": 5}]
    expect("GR mobile edit (no ids, no keys) -> header kept, lines by po_line_item_id in order, stored nulls not copied" + tag,
           {**need, **out}, {"need": "YES", "cf": {"dock": "D4"}, "lines": want_lines})
    byid = [{"id": "2", "po_line_item_id": "P2", "received_qty": 7}, {"id": "4", "po_line_item_id": "P3",
                                                                        "children": [{"id": "5", "po_line_item_id": "P4"}]}]
    need, out = chain(doc, 2, {A + ".id": "900", A + "." + H: {"dock": "D9"}, A + ".table_gr": byid}, stored, absent)
    expect("GR edit with line ids but no line keys -> filled by id, split children too, header from payload" + tag, {**need, **out},
           {"need": "YES", "cf": {"dock": "D9"}, "lines": [{"id": "2", "po_line_item_id": "P2", "received_qty": 7, L: {"lot": "b"}},
                                                          {"id": "4", "po_line_item_id": "P3", "children": [{"id": "5", "po_line_item_id": "P4", L: {"lot": "e"}}]}]})
    mixed = [{"id": "1", "po_line_item_id": "P1", L: {"lot": "A2"}}, {"po_line_item_id": "P1", "received_qty": 1}]
    need, out = chain(doc, 2, {A + ".id": "900", A + "." + H: {"dock": "D9"}, A + ".table_gr": mixed}, stored, absent)
    expect("a new line for a PO line already sent with its id -> not given that line's fields" + tag, out,
           {"lines": [{"id": "1", "po_line_item_id": "P1", L: {"lot": "A2"}}, {"po_line_item_id": "P1", "received_qty": 1}]})

    # ---------------- lines prop from another node: GOODS_RECEIVING update_node_a31whzYI (chain 1, table_gr from ApplyBatches)
    B = "node:code_node_ApplyBatches.data.table_gr"
    need, out = chain(doc, 1, {A + ".id": "900", B: mobile}, stored, absent)
    expect("GR (ApplyBatches lines) mobile edit -> same restore" + tag, {**need, **out}, {"need": "YES", "cf": {"dock": "D4"}, "lines": want_lines})

    # ---------------- header + lines by id only: SO_SAVE (line key 'custom_fields')
    doc = json.load(open(os.path.join(HERE, "out", "SO_SAVE.json")))
    S = "node:code_node_BtxYhPym.data.entry"
    stored = {"id": "5", "custom_fields_m07krnod": {"so_type": "X"}, "table_so": [{"id": "11", "custom_fields": {"kamco": 1}}]}
    need, out = chain(doc, 1, {S + ".id": "5", S + ".table_so": [{"id": "11", "so_quantity": 2}, {"so_quantity": 1}]}, stored, absent)
    expect("SO headless edit -> header + line kept by id, a new line left alone" + tag, {**need, **out},
           {"need": "YES", "cf": {"so_type": "X"}, "lines": [{"id": "11", "so_quantity": 2, "custom_fields": {"kamco": 1}}, {"so_quantity": 1}]})

print("\n%s" % ("ALL PASS" if not fails else "%d FAILURE(S)" % fails))
sys.exit(1 if fails else 0)
