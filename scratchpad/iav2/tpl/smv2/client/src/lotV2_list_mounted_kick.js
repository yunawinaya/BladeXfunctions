// Stock Movement V2: there is no scheduled worker - a background save still waiting (a retry, a parked second phase, a closed
// browser) moves on when the Location Transfer list opens (at most every 2 minutes per browser). Appended to the list's mounted.
(() => {
  const WORKER = "__LOT_V2_WORKER__"; // LOT_V2_WORKER
  if (WORKER === "0") return;
  const KEY = "lot_v2_worker_kick_at";
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
        (e) => console.error("Location Transfer V2: worker tick failed", e),
      );
    } catch (e) {
      console.error("Location Transfer V2: worker could not be started", e);
    }
  };
  tick(1);
})();
