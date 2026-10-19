// SC Review V2: there is no scheduled worker - a review's Stock Adjustment still being completed in the background (a
// retry, a stock-lock wait, a parked second phase, a closed browser) moves on when this list opens (at most every 2
// minutes per browser, shared with the Stock Adjustment list). Switched off with ASYNC_SC_REVIEW_ENABLED (or a worker id
// not set): no call, no browser storage.
(() => {
  const ASYNC_SC_REVIEW_ENABLED = true;
  const WORKER = "2111074368689180673"; // SA_V2_WORKER
  if (ASYNC_SC_REVIEW_ENABLED !== true || !/^[1-9][0-9]{0,19}$/.test(WORKER)) return;
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
        (e) => console.error("Stock Count V2: worker tick failed", e),
      );
    } catch (e) {
      console.error("Stock Count V2: worker could not be started", e);
    }
  };
  tick(1);
})();
