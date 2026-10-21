// IA V2: there is no scheduled worker - a background completion or revert still waiting (a retry, a stock-lock wait, a parked
// second phase, a closed browser) moves on when this list opens (each worker at most every 2 minutes per browser). A worker
// whose switch is off (or whose id is not set): no call, no browser storage.
(() => {
  const ASYNC_IA_ENABLED = __ASYNC_IA_ENABLED__;
  const ASYNC_IA_REVERT_ENABLED = __ASYNC_IA_REVERT_ENABLED__;
  const WORKERS = [
    { on: ASYNC_IA_ENABLED, key: "ia_v2_worker_kick_at", name: "IA V2",
      id: "__IA_V2_WORKER__" }, // IA_V2_WORKER
    { on: ASYNC_IA_REVERT_ENABLED, key: "ia_rv_worker_kick_at", name: "IA Revert V2",
      id: "__IA_REVERT_V2_WORKER__" }, // IA_REVERT_V2_WORKER
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
