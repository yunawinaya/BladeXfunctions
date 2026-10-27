  const url = new URL(window.location.href)
  const type = url.searchParams.get('type')
  const id = url.searchParams.get('id')

  if (type && id) {
    this.toView({
      title: type.charAt(0).toUpperCase() + type.slice(1),
      target: '1902054888473481218', //table id for goods_delivery
      targetType: 'Table',
      mode: 'drawer',
      ...(type === 'view' ? { viewMode: 'disabled' } : {}),
      type: type,
      data: {
        id: id
      }
    })
  }

// GD Created / Completion / Edit / Cancel / Revert V2: there is no scheduled worker - a save, a completion, an edit, a cancel, a revert
// or a Picking still waiting (a retry, a closed browser, an expired hold) moves on when the list opens (at most every 2 minutes per browser)
// While the list stays open (a background tab counts) the same kick repeats every 2 minutes: a run that reached its budget or
// crashed leaves its jobs to the next kick, and nothing else kicks once the page that queued them is closed (BA 10-25)
(() => {
  const KEY = "gdc_worker_kick_at";
  const kickAll = () => {
    let last = 0;
    try {
      last = Number(localStorage.getItem(KEY) || 0);
    } catch (e) {}
    if (Date.now() - last < 120000) return;
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch (e) {}
    const tick = (workflowId, round, moved) => {
      try {
        this.runWorkflow(
          workflowId,
          {},
          (w) => {
            if (moved((w && w.data) || {})) {
              this.refresh();
              if (round < 40) tick(workflowId, round + 1, moved);
            }
          },
          (e) => console.error("GD V2: worker tick failed", workflowId, e),
        );
      } catch (e) {
        console.error("GD V2: worker could not be started", workflowId, e);
      }
    };
    const processed = (d) => Number(d.processed || 0) > 0;
    tick("2110182645714518018", 1, processed); // GD_COMPLETE_WORKER
    tick("2110618789356687361", 1, processed); // GD_EDIT_WORKER
    tick("2104840667119411201", 1, processed); // GD_ASYNC_WORKER (GD Created)
    tick("2112455700319932418", 1, processed); // GD_CANCEL_WORKER
    tick("2112758130420088833", 1, processed); // GD_REVERT_WORKER
    // GD_PICKING_OUTBOX_CONSUMER, poll mode: the tenant's earliest due Picking of a created delivery; DONE / DONE_NONE = one handled
    tick("2105134245397041153", 1, (d) => /^DONE/.test(String(d.consumer_route || "")));
  };
  kickAll();
  if (typeof window.setInterval !== "function") return;
  // one beat per window: a re-mounted list replaces it; it stops once the page leaves the list
  const home = new URL(window.location.href).pathname;
  if (window.gdcWorkerBeat) window.clearInterval(window.gdcWorkerBeat);
  window.gdcWorkerBeat = window.setInterval(() => {
    if (new URL(window.location.href).pathname !== home) {
      window.clearInterval(window.gdcWorkerBeat);
      window.gdcWorkerBeat = null;
      return;
    }
    kickAll();
  }, 120000);
})();
