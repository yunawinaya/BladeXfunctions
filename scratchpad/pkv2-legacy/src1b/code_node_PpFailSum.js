const raw = {{node:get_cache_PpFailSum.data}};
let fails = [];
if (raw) { fails = typeof raw === "string" ? JSON.parse(raw) : raw; }
if (!Array.isArray(fails)) fails = [];

const clamped = {{node:code_node_Q3hWck9R.data.clampedLines}} || [];

// The clamp is otherwise invisible: the picker submits 10, the server records 4,
// and the app is told "processed successfully". Mobile resets the navigation stack
// on a 200, so the response message is the only channel back to the picker.
// Mirrors code_node_ClampMsg on the GD side.
let baseMessage = "Picking processed successfully";
if (Array.isArray(clamped) && clamped.length > 0) {
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
  baseMessage +=
    ". " + parts.length + " line(s) were reduced because the stock had already been" +
    " picked: " + parts.join(", ") + ". Check the document before picking again.";
}

if (fails.length === 0) {
  return { code: "200", message: baseMessage };
}

// The client keys its wording off the code (402/403 credit limit, 407 packing), so the
// FIRST failure's code passes through untouched and only the detail is appended -- the
// handlers in PickingWorkflowCompleted.js keep working with no change.
const code = fails[0].code || "400";
const names = fails
  .map((f) => f.doc_no + " (" + (f.message || f.code || "failed") + ")")
  .join("; ");
const note =
  fails.length + " of the documents on this picking were not completed automatically" +
  " and need completing manually: " + names;
const join = (base) => base + (/[.!?]\s*$/.test(base) ? " " : ". ") + note;

return { code: code, message: join(baseMessage) };
