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

// GD Completion V2 + GD Edit V2: there is no scheduled worker - a completion or an edit still waiting (a retry, a closed
// browser, an expired hold) moves on when the list opens (at most every 2 minutes per browser)
(() => {
  const KEY = "gdc_worker_kick_at";
  let last = 0;
  try {
    last = Number(localStorage.getItem(KEY) || 0);
  } catch (e) {}
  if (Date.now() - last < 120000) return;
  try {
    localStorage.setItem(KEY, String(Date.now()));
  } catch (e) {}
  const tick = (workflowId, round) => {
    try {
      this.runWorkflow(
        workflowId,
        {},
        (w) => {
          const processed = Number((w && w.data && w.data.processed) || 0);
          if (processed > 0) {
            this.refresh();
            if (round < 40) tick(workflowId, round + 1);
          }
        },
        (e) => console.error("GD V2: worker tick failed", workflowId, e),
      );
    } catch (e) {
      console.error("GD V2: worker could not be started", workflowId, e);
    }
  };
  tick("2110182645714518018", 1); // GD_COMPLETE_WORKER
  tick("2110618789356687361", 1); // GD_EDIT_WORKER
})();
