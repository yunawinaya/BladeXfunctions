// onFormChange - Small Cycle (scratchpad/iasc): RES-01 MIN-06 (BA 10-22). A Created IA's reservation row says when the form holds
// unsaved changes to what the reservation reads (its figures are the last save's), and drops it when they match again. The newest change
// checks 400 ms later (a burst, e.g. an auto-allocation, costs one check); nothing to do for an IA whose row has no fingerprint.
/*@@RES_FP@@*/
(() => {
  const st = this.models["_data"] || {};
  if (!st.res_fp) return;
  const seq = (Number(st.res_seq) || 0) + 1;
  this.models["_data"] = Object.assign({}, st, { res_seq: seq });
  setTimeout(() => {
    const now = this.models["_data"] || {};
    if (now.res_seq !== seq || !now.res_fp) return;
    const dirty = resFp(this.getValues()) !== now.res_fp;
    if (dirty === (now.res_dirty === true)) return;
    this.models["_data"] = Object.assign({}, now, { res_dirty: dirty });
    this.setData({ res_summary: String(now.res_row || "") + (dirty ? RES_DIRTY : "") });
  }, 400);
})();
