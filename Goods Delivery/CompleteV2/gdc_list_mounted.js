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

// GD Completion V2: there is no scheduled worker - a completion still waiting (a retry, a closed browser) moves on when
// the list opens (at most every 2 minutes per browser)
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
  const tick = (round) => {
    try {
      this.runWorkflow(
        "2110182645714518018", // GD_COMPLETE_WORKER
        {},
        (w) => {
          const processed = Number((w && w.data && w.data.processed) || 0);
          if (processed > 0) {
            this.refresh();
            if (round < 40) tick(round + 1);
          }
        },
        (e) => console.error("GD Completion V2: worker tick failed", e),
      );
    } catch (e) {
      console.error("GD Completion V2: worker could not be started", e);
    }
  };
  tick(1);
})();
