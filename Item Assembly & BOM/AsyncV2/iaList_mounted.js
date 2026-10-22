// IA V2: there is no scheduled worker - a background completion or revert still waiting (a retry, a stock-lock wait, a parked
// second phase, a closed browser) moves on when this list opens (each worker at most every 2 minutes per browser). A worker
// whose switch is off (or whose id is not set): no call, no browser storage.
(() => {
  const ASYNC_IA_ENABLED = true;
  const ASYNC_IA_REVERT_ENABLED = true;
  const WORKERS = [
    { on: ASYNC_IA_ENABLED, key: "ia_v2_worker_kick_at", name: "IA V2",
      id: "2112141277456408577" }, // IA_V2_WORKER
    { on: ASYNC_IA_REVERT_ENABLED, key: "ia_rv_worker_kick_at", name: "IA Revert V2",
      id: "2112141417890095105" }, // IA_REVERT_V2_WORKER
  ];
  for (const worker of WORKERS) {
    if (worker.on !== true || !/^[1-9][0-9]{0,19}$/.test(worker.id)) continue;
    let last = 0;
    try {
      last = Number(localStorage.getItem(worker.key) || 0);
    } catch (e) {}
    if (Date.now() - last < 120000) continue;
    try {
      localStorage.setItem(worker.key, String(Date.now()));
    } catch (e) {}
    const tick = (round) => {
      try {
        const p = this.runWorkflow(
          worker.id,
          { job_id: "" },
          (w) => {
            const processed = Number((w && w.data && w.data.processed) || 0);
            if (processed > 0) {
              this.refresh();
              if (round < 40) tick(round + 1);
            }
          },
          (e) => console.error(worker.name + ": worker tick failed", e),
        );
        if (p && typeof p.catch === "function") p.catch(() => {});
      } catch (e) {
        console.error(worker.name + ": worker could not be started", e);
      }
    };
    tick(1);
  }
})();
// RES-01 MIN-03 (BA 10-22): a reservation still pending (a Created save whose browser closed before IA_HOLD answered) is finished when
// this list opens: at most 10 such IAs, one at a time, at most every 2 minutes per browser; IA_HOLD re-reads each one and refuses what
// no longer fits. The switch off: none started (it makes holds). MIN-05: the IAs deleted while still holding (a delete interrupted
// between its header write and its release) are released, at most every 10 minutes per browser, whatever the switch (finishing
// holds is never switched off). No IA_HOLD id: no read, no call, no browser storage.
(() => {
  const IA_RES_ENABLED = true;
  const RES_HOLD = "2112752274794217473"; // IA_HOLD
  if (!/^[1-9][0-9]{0,19}$/.test(RES_HOLD)) return;
  const due = (key, ms) => {
    let last = 0;
    try {
      last = Number(localStorage.getItem(key) || 0);
    } catch (e) {}
    if (Date.now() - last < ms) return false;
    try {
      localStorage.setItem(key, String(Date.now()));
    } catch (e) {}
    return true;
  };
  const pending = IA_RES_ENABLED === true && due("ia_res_kick_at", 120000);
  const sweep = due("ia_res_sweep_at", 600000);
  if (!pending && !sweep) return;
  const s = (v) => (v === undefined || v === null ? "" : String(v));
  const digits = (v) => /^[0-9]{1,20}$/.test(s(v));
  const run = (params) =>
    new Promise((resolve, reject) => {
      const p = this.runWorkflow(RES_HOLD, params, (res) => resolve(res), (err) => reject(err));
      if (p && typeof p.then === "function") p.then((res) => resolve(res), (err) => reject(err));
    });
  (async () => {
    if (pending) {
      let rows = [];
      try {
        const res = await db
          .collection("sm_item_assembly")
          .field("id,organization_id")
          .filter([{ type: "branch", operator: "all", children: [{ prop: "material_hold_status", operator: "equal", value: "RESERVING" },
            { prop: "item_assembly_status", operator: "equal", value: "Created" }, { prop: "is_deleted", operator: "equal", value: 0 }] }])
          .limit(10)
          .get();
        rows = res && Array.isArray(res.data) ? res.data : [];
      } catch (e) {
        console.error("RES-01: the pending reservations could not be read", e);
      }
      let moved = false;
      for (const r of rows) {
        if (!digits(r && r.id) || !digits(r && r.organization_id)) continue;
        try {
          const res = await run({ ia_id: s(r.id), organization_id: s(r.organization_id), operation: "RECONCILE", source: "LIST" });
          const d = (res && res.data) || {};
          let status = "";
          try {
            status = s(JSON.parse(s(d.result_json) || "{}").status);
          } catch (e) {}
          if (s(d.code) === "200" && status !== "" && status !== "RESERVING") moved = true;
        } catch (e) {
          console.error("RES-01: a pending reservation could not be finished now", e);
        }
      }
      if (moved) this.refresh();
    }
    if (sweep) {
      let ias = [];
      try {
        const res = await run({ ia_id: "0", organization_id: "0", operation: "SWEEP", source: "LIST" });
        const d = (res && res.data) || {};
        const r = s(d.code) === "200" ? JSON.parse(s(d.result_json) || "{}") : {};
        ias = Array.isArray(r.ias) ? r.ias : [];
      } catch (e) {
        console.error("RES-01: the reservations of deleted Item Assemblies could not be read", e);
      }
      for (const x of ias) {
        if (!digits(x && x.id) || !digits(x && x.org)) continue;
        try {
          await run({ ia_id: s(x.id), organization_id: s(x.org), operation: "RELEASE_ALL", source: "LIST" });
        } catch (e) {
          console.error("RES-01: a deleted Item Assembly's reservation could not be released now", e);
        }
      }
    }
  })();
})();
