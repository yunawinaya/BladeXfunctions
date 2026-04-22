// PackingProcessWorkflow — node 3: Server-side re-validate
// Paste into the code-node. Mirrors client-side checks in PackingCompletedWorkflow.js
// so a direct workflow call (bypassing client) still gets caught.

const allData = {{workflowparams:allData}};
const EPS = 0.001;
const errors = [];

// table_item_source: every row fully picked
for (const r of allData.table_item_source || []) {
  const remaining = parseFloat(r.remaining_qty) || 0;
  if (remaining > EPS || r.line_status !== "Fully Picked") {
    errors.push(
      `Item ${r.item_code || r.item_name || r.id || "(?)"} is not fully packed.`,
    );
  }
}

// table_hu_source: every header row Completed
for (const r of allData.table_hu_source || []) {
  if (r.row_type !== "header") continue;
  if (r.hu_status !== "Completed") {
    errors.push(
      `Source HU ${r.handling_no || r.handling_unit_id || "(?)"} is not completed.`,
    );
  }
}

// table_hu: every row with temp_data must be Completed; packing must have rows
const tableHu = allData.table_hu || [];
if (tableHu.length === 0) {
  errors.push("Packing has no HU rows to complete.");
} else {
  for (const r of tableHu) {
    if (!r.temp_data || r.temp_data === "[]") continue;
    if (r.hu_status !== "Completed") {
      errors.push(`HU ${r.handling_no || "(unnumbered)"} is not completed.`);
    }
  }
}

const preview = errors.slice(0, 3).join("; ");
const suffix = errors.length > 3 ? ` (+${errors.length - 3} more)` : "";

return {
  ok: errors.length === 0 ? 1 : 0,
  errorCount: errors.length,
  errorMsg: errors.length > 0 ? `${preview}${suffix}` : "",
};
