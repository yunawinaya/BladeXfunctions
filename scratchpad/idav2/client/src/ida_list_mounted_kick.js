// IDA V2: no scheduled worker - a background completion still waiting (a retry, a stock-lock wait, a parked second phase, a closed
// browser) moves on when this list opens (at most every 2 minutes per browser). Switch off or id not set: no call, no storage.
(() => {
  const ASYNC_IDA_ENABLED = __ASYNC_IDA_ENABLED__;
  const WORKER = "__IDA_V2_WORKER__"; // IDA_V2_WORKER
  const KEY = "ida_v2_worker_kick_at";
  if (ASYNC_IDA_ENABLED !== true || !/^[1-9][0-9]{0,19}$/.test(WORKER)) return;
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
      const p = this.runWorkflow(
        WORKER,
        { job_id: "" },
        (w) => {
          const processed = Number((w && w.data && w.data.processed) || 0);
          if (processed > 0) {
            this.refresh();
            if (round < 40) tick(round + 1);
          }
        },
        (e) => console.error("IDA V2: worker tick failed", e),
      );
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch (e) {
      console.error("IDA V2: worker could not be started", e);
    }
  };
  tick(1);
})();
