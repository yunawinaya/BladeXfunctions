// SA V2: there is no scheduled worker - a background completion still waiting (a retry, a stock-lock wait, a parked second
// phase, a closed browser) moves on when this list opens (at most every 2 minutes per browser, shared with the Stock Count
// list). Switched off with ASYNC_SA_ENABLED (or a worker id not set): no call, no browser storage.
(() => {
  const ASYNC_SA_ENABLED = true;
  const WORKER = "2111074368689180673"; // SA_V2_WORKER
  if (ASYNC_SA_ENABLED !== true || !/^[1-9][0-9]{0,19}$/.test(WORKER)) return;
  const KEY = "sa_v2_worker_kick_at";
  let last = 0;
  try {
    last = Number(localStorage.getItem(KEY) || 0);
  } catch (e) {}
  if (Date.now() - last < 120000) return;
  try {
    localStorage.setItem(KEY, String(Date.now()));
  } catch (e) {}
  const tick = (round) => {
    try {
      this.runWorkflow(
        WORKER,
        { job_id: "" },
        (w) => {
          const processed = Number((w && w.data && w.data.processed) || 0);
          if (processed > 0) {
            this.refresh();
            if (round < 40) tick(round + 1);
          }
        },
        (e) => console.error("Stock Adjustment V2: worker tick failed", e),
      );
    } catch (e) {
      console.error("Stock Adjustment V2: worker could not be started", e);
    }
  };
  tick(1);
})();
