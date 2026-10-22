#!/usr/bin/env python3
"""TEST ONLY (never publish): can a child ADD_INVENTORY update the same item_balance row inside a locked SUBTRACT_INVENTORY run?

3f's question for the pair entry (22 Oct): if the platform held the parent run's row locks until the parent ends, a nested child
writing the same row would wait for its own parent (deadlock / lock-wait timeout), or would write over a stale read.
From the live v62 build (out/q_SUBTRACT_INVENTORY.json) this writes out/nest_test.json: right after the locked path's balance write
(update_node_CLwb), still holding the key, it calls the PUBLISHED ADD_INVENTORY with an ordinary trx_no (its unlocked path, so it
never touches the lock row) on the same material / bin / category, +quantity. Expected with per-node commits: no wait, and the
balance ends where it started.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_subtract_lock as L  # noqa: E402

ADD_WF = {"source": "ADD_INVENTORY:Workflow:2012005532688723970", "collectionId": "2012005532688723970"}

doc = json.load(open(os.path.join(L.ROOT, "out", "q_SUBTRACT_INVENTORY.json"), encoding="utf-8"))
child = L.workflow_node("workflow_node_CLnest", "TEST: nested ADD_INVENTORY on the same row, key still held", ADD_WF, [
    ("plant_id", "{{workflowparams:plant_id}}"), ("organization_id", "{{workflowparams:organization_id}}"),
    ("material_id", "{{workflowparams:material_id}}"), ("quantity", "{{workflowparams:quantity}}"),
    ("material_uom", "{{workflowparams:material_uom}}"), ("unit_price", "{{node:code_node_mQnskse9.data.calculatedUnitPrice}}"),
    ("transaction_type", "{{workflowparams:transaction_type}}"), ("trx_no", "MIN01-NEST-CHILD"), ("parent_trx_no", ""),
    ("inventory_category", "{{workflowparams:inventory_category}}"), ("location_id", "{{workflowparams:location_id}}"),
    ("batch_id", "{{workflowparams:batch_id}}"), ("doc_date", "{{workflowparams:doc_date}}"), ("index", "0"),
    ("po_quantity", "0"), ("po_amount", "0"), ("exchange_rate", "1"), ("isMovingInv", "{{workflowparams:isMovingInv}}"),
    ("remark", "MIN-01 nested test"),
])
holder = L.parent_list(doc, "update_node_CLwb")
at = [i for i, x in enumerate(holder) if x.get("id") == "update_node_CLwb"][0]
holder[at + 1:at + 1] = [child]
L.check(doc)
with open(os.path.join(L.ROOT, "out", "nest_test.json"), "w", encoding="utf-8") as f:
    json.dump(doc, f, ensure_ascii=False)
print("TEST ONLY -> out/nest_test.json")
