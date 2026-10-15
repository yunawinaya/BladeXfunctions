"""Generates scratchpad/pwv2/code/worker/*.js from GR Completion V2's worker code (scratchpad/grv2/code/worker, itself
generated from GD's): same claim gate / lease / retry / SPLIT logic, Putaway names; the lock released before COMMIT is the
Transfer Order Putaway's is_processing flag. Run: python3 gen_worker_code.py"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "grv2", "code", "worker")
DST = os.path.join(HERE, "code", "worker")
SUBS = [
    ("GR_COMPLETE_WORKER", "PUTAWAY_ASYNC_WORKER"),
    ("GR_COMPLETE_PREPARE", "PUTAWAY_BULK_PREPARE"),
    ("GR_COMPLETE_COMMIT", "PUTAWAY_BULK_COMMIT"),
    ("COMPLETE_GR", "COMPLETE_PUTAWAY"),
    ("COMMITTING_GR", "COMMITTING_PUTAWAY"),
    ("GRC_GR_NOT_FOUND", "PWC_TO_NOT_FOUND"),
    ("GRC_PO_CHANGED", "PWC_TRANSIT_CHANGED"),
    ("GRC_", "PWC_"),
    ("code_node_RW", "code_node_PW"),
    ("sql_node_RW", "sql_node_PW"),
    ("get_cache_RW", "get_cache_PW"),
    ("put the Goods Receiving back to its status before the submit", "release the putaway (is_processing 0)"),
    ("the Goods Receiving back to its status before the submit", "the putaway released (is_processing 0)"),
    ("the Goods Receiving stays Processing", "the putaway stays locked"),
    ("Goods Receiving", "Putaway"),
    ("for the purchase orders, the putaway and the finish", "for the records, the in-transit ledger and the finish"),
    ("this receipt", "this putaway"),
    ("the receipt was completed", "the putaway was completed"),
    ("before the receipt", "before the putaway"),
    ("grId", "toId"),
    ("gr_id", "to_id"),
]
UNLOCK = [('{ id: s(pick.toId), gr_status: s(item.prevStatus) || "Draft" }', "{ id: s(pick.toId), is_processing: 0 }"),
          ('{ id: s(own.toId), gr_status: s(own.prevStatus) || "Draft" }', "{ id: s(own.toId), is_processing: 0 }")]


def gen():
    os.makedirs(DST, exist_ok=True)
    for name in sorted(os.listdir(SRC)):
        if not name.endswith(".js"):
            continue
        body = open(os.path.join(SRC, name), encoding="utf-8").read()
        for a, b in SUBS:
            body = body.replace(a, b)
        for a, b in UNLOCK:
            body = body.replace(a, b)
        left = [w for w in ("gr_status", "COMPLETE_GR", "GRC_", "_RW", "grId", "Goods Receiving", "receipt") if w in body]
        assert not left, (name, left)
        open(os.path.join(DST, name), "w", encoding="utf-8").write(body)
        print("wrote", name)


if __name__ == "__main__":
    gen()
