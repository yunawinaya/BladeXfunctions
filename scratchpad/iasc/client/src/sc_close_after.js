// Small Cycle (scratchpad/iasc): RES-01 - after a completion the form closes the IA's holds (IA_HOLD CLOSE: what the completion issued
// from Reserved delivered, the rest released), in the background: IA_SAVE / IA V2 never run it (a crash inside would fail them after the
// stock moved; user 10-21). Only an IA that reserves, whatever the switch (it only makes holds; review I4); opening a completed IA that still
// holds stock starts it again.
const RES_HOLD = "__IA_HOLD__"; // IA_HOLD
const resCloseAfter = (saved, data) => {
  const s = (v) => (v === undefined || v === null ? "" : String(v));
  const raw = saved && saved.id;
  const id = s(Array.isArray(raw) ? raw[0] : raw) || s(data && data.id);
  if (!/^[1-9][0-9]{0,19}$/.test(RES_HOLD) || !/^[0-9]{1,20}$/.test(id) || !/^[0-9]{1,20}$/.test(s(data && data.organization_id))) return;
  // a new IA completed at once never held anything
  if (s(data.page_status) !== "Edit" || !s(data.material_hold_status)) return;
  try {
    const p = this.runWorkflow(RES_HOLD, { ia_id: id, organization_id: s(data.organization_id), operation: "CLOSE", source: "COMPLETE" }, () => {},
      (e) => console.error("RES-01: closing the holds failed", e));
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (e) {
    console.error("RES-01: closing the holds could not be started", e);
  }
};
// -- end Small Cycle --
