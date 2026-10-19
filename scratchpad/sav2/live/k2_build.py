"""RUNBOOK step K (2k SC Review V2) - package E's live/build_review_2k.py run on CLEAN items only, read-only. E's builder (issue /
review, unchanged) gets a Stock whose items() leaves out what would make the live run test something else:
  - the SACRACE* items (the race test left their cost rows inconsistent on purpose) and the SAV2T* twin items (their deltas are
    the twin tests' evidence);
  - items whose cost rows need migration at the plant (FIFO item with WA rows / WA item with FIFO rows / both): SUBMIT would
    answer NOT_ELIGIBLE, the engine UNSUPPORTED_COSTING;
  - items with an engine lock held (ITEM| / BATCH| / COST| rows naming the material, free_token <> 1): the job would wait 409s
    and fail SA_INVENTORY_LOCK_BUSY;
  - items with duplicate balance rows on a (material, bin[, batch]) key at the plant (engine DUPLICATE_BALANCE).
Files go to <out_dir>/k2/ (session scratchpad).
  python3 k2_build.py check                         what is excluded and why; open V2 jobs of the tenant; the 2k plan's freshness
  python3 k2_build.py issue [--lines 2000] [...]    = E's issue: plan.json + sc_issue.json (STOCK_COUNT Issued, Add - a WRITE the
                                                    controller runs) + sc_review.preview.json
  python3 k2_build.py review --sc-id ID             = E's review on the stored SC: sc_count.json (STOCK_COUNT "Stock Count", Edit -
                                                    WRITE), sa_v2_submit_review.json (SA_V2_SUBMIT REVIEW - WRITE), sc_review.json
                                                    (the classic Review: NOT to run - the guard refuses > 500 lines),
                                                    review_engine_input.json + the engine planner's verdict on today's rows
Other E options (--out-share, --out-qty, --in-qty, --seed) pass through."""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, HERE)
import twinlib as L  # noqa: E402
import stock_reads as S  # noqa: E402  (E's, unchanged)
import build_review_2k as E  # noqa: E402  (E's, unchanged)

EXCLUDE_PREFIX = ("SACRACE", "SAV2T")


class CleanStock(S.Stock):
    def __init__(self, tenant, org, plant):
        super().__init__(tenant, org, plant)
        self._items = None
        self.excluded = {}

    def items(self):
        if self._items is not None:
            return self._items
        its = super().items()
        t, plant = self.t, self.plant
        ids = sorted(its)
        mig, held, dup = set(), set(), set()
        for part in S.chunks(ids):
            idl = ",".join(part)
            for r in S.q("--dev", "SELECT CAST(i.id AS CHAR) id, i.material_costing_method m, (SELECT COUNT(*) FROM fifo_costing_history f WHERE f.tenant_id = i.tenant_id "
                                  f"AND f.is_deleted = 0 AND f.material_id = i.id AND f.plant_id = {plant}) nf, (SELECT COUNT(*) FROM wa_costing_method w WHERE "
                                  f"w.tenant_id = i.tenant_id AND w.is_deleted = 0 AND w.material_id = i.id AND w.plant_id = '{plant}') nw FROM item i "
                                  f"WHERE i.tenant_id = '{t}' AND i.id IN ({idl})"):
                nf, nw = int(r["nf"]), int(r["nw"])
                if (nf and nw) or (r["m"] == S.FIFO and not nf and nw) or (r["m"] == S.WA and not nw and nf):
                    mig.add(r["id"])
        locks = S.q("--dev", f"SELECT lock_key FROM inventory_balance_lock WHERE tenant_id = '{t}' AND organization_id = '{self.org}' AND is_deleted = 0 "
                             "AND (free_token IS NULL OR free_token <> 1) AND (lock_key LIKE 'ITEM|%' OR lock_key LIKE 'BATCH|%' OR lock_key LIKE 'COST|%')")
        for r in locks:
            parts = r["lock_key"].split("|")
            if len(parts) > 1 and parts[1] in its:
                held.add(parts[1])
        for table, cols in (("item_balance", "material_id, location_id"), ("item_batch_balance", "material_id, location_id, batch_id")):
            for r in S.q("--dev", f"SELECT CAST(material_id AS CHAR) m FROM {table} WHERE tenant_id = '{t}' AND is_deleted = 0 AND plant_id = {plant} "
                                  f"GROUP BY {cols}, organization_id HAVING COUNT(*) > 1"):
                dup.add(r["m"])
        out = {}
        for mid, it in its.items():
            why = ("test item (" + (it["material_code"] or "") + ")") if (it["material_code"] or "").startswith(EXCLUDE_PREFIX) else \
                "cost rows need migration" if mid in mig else "engine lock held" if mid in held else "duplicate balance rows" if mid in dup else ""
            if why:
                self.excluded[mid] = why
            else:
                out[mid] = it
        self._items = out
        return out


def check(st):
    its = st.items()
    by = {}
    for mid, why in st.excluded.items():
        by.setdefault(why if not why.startswith("test item") else "test items (SACRACE* / SAV2T*)", []).append(mid)
    print(f"tenant {st.t} plant {st.plant}: {len(its)} clean FIFO / WA stock-controlled items; excluded {len(st.excluded)}:")
    for why, mids in sorted(by.items()):
        print(f"  {why}: {len(mids)}" + (f"  e.g. {mids[:3]}" if mids else ""))
    jobs = S.q("--dev", f"SELECT command, job_status, COUNT(*) n FROM gd_async_job WHERE tenant_id = '{st.t}' AND is_deleted = 0 AND job_status IN "
                        "('QUEUED','VALIDATING','READY_TO_COMMIT','COMMITTING','COMMITTING_SA','REQUIRES_REVIEW') GROUP BY command, job_status")
    print("open V2 jobs of the tenant: " + (", ".join(f"{r['command']} {r['job_status']} x{r['n']}" for r in jobs) or "none"))
    recent = S.q("--dev", f"SELECT COUNT(*) n, COUNT(DISTINCT trx_no) docs, MAX(create_time) t FROM inventory_movement WHERE tenant_id = '{st.t}' AND plant_id = {st.plant} "
                          "AND create_time > NOW() - INTERVAL 1 HOUR AND COALESCE(trx_no, '') NOT LIKE 'SACRACE%'")[0]
    print(f"plant traffic, last hour (not the race): {recent['n']} movements in {recent['docs']} documents (latest {recent['t']}) - other sessions' "
          "completions on the same items only wait on the engine's locks (409), they do not break the reconcile (it counts every movement in its window)")
    plan = os.path.join(L.out_dir(L.load_config(), "k2"), "plan.json")
    if os.path.exists(plan):
        import json
        with open(plan) as fh:
            p = json.load(fh)
        bad = sorted({l["material_id"] for l in p["lines"]} - set(its))
        print(f"existing k2/plan.json: {len(p['lines'])} lines, {len(bad)} of its materials not clean now" + (f" (e.g. {bad[:3]}) -> re-run issue" if bad else ""))
    else:
        print("no k2/plan.json yet: run `k2_build.py issue`")


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("check", "issue", "review"):
        raise SystemExit(__doc__)
    cfg = L.load_config()
    st = CleanStock(L.arg("--tenant", cfg["tenant_id"]), L.arg("--org", cfg["organization_id"]), L.arg("--plant", cfg["plant_id"]))
    out = L.out_dir(cfg, "k2")
    if sys.argv[1] == "check":
        check(st)
    elif sys.argv[1] == "issue":
        st.items()
        print(f"(clean items only: {len(st.excluded)} excluded - `k2_build.py check` lists why)")
        E.issue(st, out)
    else:
        st.items()
        E.review(st, out)


if __name__ == "__main__":
    main()
