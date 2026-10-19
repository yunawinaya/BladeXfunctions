// GOODS_DELIVERY's full re-save took the dev server down on a 2,000-line GD (2026-10-09). The cases that still
// need it (force complete, loading bay, a bin/batch move) are refused on a big GD before anything is written.
const MAX_SYNC_GD_LINES = 500;
const raw = {{node:sql_node_GdLineCount.data}};
const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
const lineCounts = {};
let maxLines = 0;
for (const r of rows) {
  const n = Number(r.line_count) || 0;
  lineCounts[String(r.gd_id)] = n;
  if (n > maxLines) maxLines = n;
}

const setupRaw = {{node:get_node_Uj1uV9PU.data.data}};
const setup = (Array.isArray(setupRaw) ? setupRaw[0] : setupRaw) || {};
const isForceComplete = Number({{workflowparams:isForceComplete}} || 0) === 1;
const isLoadingBay = Number(setup.is_loading_bay || 0) === 1;
const anyTempChanged = Number({{node:code_node_iES7iMKA.data.anyTempChanged}} || 0) === 1;
const needFullSave = isForceComplete || isLoadingBay || anyTempChanged ? 1 : 0;

if (needFullSave === 1 && maxLines > MAX_SYNC_GD_LINES) {
  const what = isForceComplete
    ? "Force Complete"
    : isLoadingBay
      ? "A loading bay move"
      : "Moving picked stock to another bin or batch";
  return {
    code: "400",
    message: what + " is not available yet for a Goods Delivery above " + MAX_SYNC_GD_LINES +
      " lines (this one has " + maxLines + "). Nothing was saved.",
    lineCounts,
    needFullSave,
    maxLines,
  };
}

return { code: "200", message: "", lineCounts, needFullSave, maxLines };
