// Putaway Completion V2: there is no scheduled worker - a completion still waiting (a retry, a closed browser) moves on when
// the Putaway list opens (at most every 2 minutes per browser). Append to the Putaway list page's `mounted`.
(() => {
  const WORKER = "2110545857423511553"; // PUTAWAY_ASYNC_WORKER
  if (WORKER === "0") return;
  const KEY = "pwv2_worker_kick_at";
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
        {},
        (w) => {
          const processed = Number((w && w.data && w.data.processed) || 0);
          if (processed > 0) {
            this.refresh();
            if (round < 40) tick(round + 1);
          }
        },
        (e) => console.error("Putaway Completion V2: worker tick failed", e),
      );
    } catch (e) {
      console.error("Putaway Completion V2: worker could not be started", e);
    }
  };
  tick(1);
})();
