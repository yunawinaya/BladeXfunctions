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
// Each kick drains its worker (10-27): one run at a time, the next one 3 s after a run that moved a job (one stock call per run,
// so one job per run). It ends on a run that moved nothing, after 40 runs or 3 failures, or when the page leaves the list. The
// old chain started the next run inside the answer, beside the list refresh, and that run never went out: one open list cleared
// one job per 2 minutes (Kenhin 10-27: 14 GDs stuck in Processing). With no answer after 60 s the next run starts anyway.
(() => {
  const KEY = "gdc_worker_kick_at";
  const NEXT_MS = 3000;
  const LOST_MS = 60000;
  const ROUNDS = 40;
  const FAILURES = 3;
  const home = new URL(window.location.href).pathname;
  const onList = () => {
    try {
      return new URL(window.location.href).pathname === home;
    } catch (e) {
      return false;
    }
  };
  // one drain per worker per window; a re-mounted list hands the drains still running its own page and they go on
  const drains = (window.gdcWorkerDrain = window.gdcWorkerDrain || {});
  Object.keys(drains).forEach((id) => {
    if (drains[id].active) drains[id].page = this;
  });
  const drain = (workflowId, name, moved) => {
    const d = drains[workflowId] || (drains[workflowId] = {});
    d.page = this;
    if (d.active) return;
    d.active = true;
    let round = 0;
    let failures = 0;
    const run = () => {
      if (!onList() || round >= ROUNDS || failures >= FAILURES) {
        d.active = false;
        return;
      }
      round += 1;
      let settled = false;
      let lost = null;
      const settle = (nextMs) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(lost);
        if (nextMs === null) d.active = false;
        else window.setTimeout(run, nextMs);
      };
      lost = window.setTimeout(() => {
        console.warn("GD V2: " + name + " run " + round + " sent no answer within 60 s; starting the next run");
        settle(0);
      }, LOST_MS);
      try {
        d.page.runWorkflow(
          workflowId,
          {},
          (w) => {
            const more = moved((w && w.data) || {});
            settle(more ? NEXT_MS : null);
            if (!more) return;
            try {
              d.page.refresh();
            } catch (e) {
              console.error("GD V2: list refresh failed", e);
            }
          },
          (e) => {
            console.error("GD V2: " + name + " run " + round + " failed", e);
            failures += 1;
            settle(LOST_MS);
          },
        );
      } catch (e) {
        console.error("GD V2: " + name + " could not be started", e);
        failures += 1;
        settle(LOST_MS);
      }
    };
    run();
  };
  // a run moved a job when one of its jobs left the state it was read in (processed counts the jobs read, not the ones moved)
  const movedJob = (d) => {
    if (String(d.worker_route || "") !== "WORKED") return false;
    try {
      const jobs = JSON.parse(d.jobs || "[]");
      return Array.isArray(jobs) && jobs.some((j) => j && String(j.before || "") !== String(j.job_status || ""));
    } catch (e) {
      return Number(d.processed || 0) > 0;
    }
  };
  const WORKERS = [
    ["2110182645714518018", "GD_COMPLETE_WORKER", movedJob],
    ["2110618789356687361", "GD_EDIT_WORKER", movedJob],
    ["2104840667119411201", "GD_ASYNC_WORKER", movedJob], // GD Created
    ["2112455700319932418", "GD_CANCEL_WORKER", movedJob],
    ["2112758130420088833", "GD_REVERT_WORKER", movedJob],
    // GD_PICKING_OUTBOX_CONSUMER, poll mode: the tenant's earliest due Picking of a created delivery; DONE / DONE_NONE = one handled
    ["2105134245397041153", "GD_PICKING_OUTBOX_CONSUMER", (d) => /^DONE/.test(String(d.consumer_route || ""))],
  ];
  const kickAll = () => {
    let last = 0;
    try {
      last = Number(localStorage.getItem(KEY) || 0);
    } catch (e) {}
    if (Date.now() - last < 120000) return;
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch (e) {}
    WORKERS.forEach(([id, name, moved]) => drain(id, name, moved));
  };
  kickAll();
  if (typeof window.setInterval !== "function") return;
  // one beat per window: a re-mounted list replaces it; it stops once the page leaves the list
  if (window.gdcWorkerBeat) window.clearInterval(window.gdcWorkerBeat);
  window.gdcWorkerBeat = window.setInterval(() => {
    if (!onList()) {
      window.clearInterval(window.gdcWorkerBeat);
      window.gdcWorkerBeat = null;
      return;
    }
    kickAll();
  }, 120000);
})();
