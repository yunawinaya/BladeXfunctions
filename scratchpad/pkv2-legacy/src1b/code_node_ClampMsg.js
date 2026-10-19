// The clamp is otherwise invisible: the picker submits 10, the server records 4,
// and the app is told "processed successfully". Mobile resets the navigation
// stack on a 200, so there is no screen left to refetch into -- the response
// message is the only channel that reaches the picker.
const clamped = {{node:code_node_oHIIKfiw.data.clampedLines}} || [];

const BASE = "Picking processed successfully";
const PACK = "Packing TBC";

if (!Array.isArray(clamped) || clamped.length === 0) {
  return { message: BASE, packingMessage: PACK };
}

// One line can clamp at several locations; report it once, summed.
const byLine = {};
for (const c of clamped) {
  const k = String(c.picking_item_id || "");
  if (!byLine[k]) byLine[k] = { name: c.item_name || k, requested: 0, allowed: 0 };
  byLine[k].requested += Number(c.requested) || 0;
  byLine[k].allowed += Number(c.allowed) || 0;
}

const r3 = (v) => Math.round(v * 1000) / 1000;
const parts = Object.keys(byLine).map((k) => {
  const e = byLine[k];
  return e.name + " " + r3(e.requested) + String.fromCharCode(8594) + r3(e.allowed);
});

const note =
  " " + parts.length + " line(s) were reduced because the stock had already been" +
  " picked: " + parts.join(", ") + ". Check the document before picking again.";

return { message: BASE + "." + note, packingMessage: PACK + "." + note };
