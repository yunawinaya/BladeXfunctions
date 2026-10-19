const raw = {{node:get_cache_GdFailSum.data}};
let fails = [];
if (raw) { fails = typeof raw === "string" ? JSON.parse(raw) : raw; }
if (!Array.isArray(fails)) fails = [];

const baseMessage = {{node:code_node_ClampMsg.data.message}};
const basePacking = {{node:code_node_ClampMsg.data.packingMessage}};

if (fails.length === 0) {
  return { code: "200", message: baseMessage, packingMessage: basePacking };
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

return { code: code, message: join(baseMessage), packingMessage: join(basePacking) };
