#!/usr/bin/env python3
"""Replays GOODS_DELIVERY code_node_QtyCheckBatch, BASE (prod v174) vs the built one, on recorded prod runs.

usage: python3 test_so_to_gd.py [built GDheadWorkflow.PROD.json]   (default: the repo file)
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "2026-10-08-bug-register"))
import replay_tests as rt  # noqa: E402
import build_repair_sql as brs  # noqa: E402  recorded()
import build_so_to_gd as bs  # noqa: E402

# The two GOODS_DELIVERY runs SO_AUTO_GD lost its batch to (2026-10-13 00:31, SO line deleted at 00:22).
THREW = [2109683369410433025, 2109683373189500930]
# Successful prod runs from seven tenants, 2026-10-13 11:22-11:44.
PASSED = [2109852614387699714, 2109852242843668481, 2109850794999287809, 2109850598315790338,
          2109850293247283201, 2109850272489672705, 2109850215417778178, 2109848539604586498,
          2109848440761618433, 2109848201900199937, 2109847620167012354, 2109847129936760833]


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else bs.GD_PROD
    _, base = bs.enabled("--prod", bs.GD_ID)
    new = json.load(open(path, encoding="utf-8"))
    old_code = bs.bp.node(base, "code_node_QtyCheckBatch")["data"]["script"]["code"]
    new_code = bs.bp.node(new, "code_node_QtyCheckBatch")["data"]["script"]["code"]

    for run in THREW:
        params, nodes = brs.recorded(run)
        try:
            rt.run(old_code, params, nodes, rt.run_time_ms(run))
            raise AssertionError(f"{run}: BASE did not throw")
        except RuntimeError as e:
            assert "was not found" in str(e), str(e)[:200]
        out = rt.run(new_code, params, nodes, rt.run_time_ms(run))
        assert out["soLineMissing"] == 1 and out["itemNotFound"] == 0 and out["validationMessage"] is None
        print(f"  {run}: BASE throws 'sales order line ... was not found'; NEW returns soLineMissing 1:\n"
              f"     {out['soLineMissingMessage']}")

    for run in PASSED:
        params, nodes = brs.recorded(run)
        recorded = nodes["code_node_QtyCheckBatch"]["data"]
        out = rt.run(new_code, params, nodes, rt.run_time_ms(run))
        assert rt.same_as_recorded(out, recorded), f"{run}: NEW differs from what the run recorded"
        assert out["soLineMissing"] == 0 and out["soLineMissingMessage"] == ""
    print(f"  {len(PASSED)} successful runs: NEW output = recorded output, soLineMissing 0")
    print("all passed")


if __name__ == "__main__":
    main()
