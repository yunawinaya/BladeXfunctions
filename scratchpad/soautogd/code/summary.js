const raw = {{node:get_results_final.data}};

let results = [];
if (raw) {
  results = typeof raw === "string" ? JSON.parse(raw) : raw;
}
if (!Array.isArray(results)) results = [];

// A combined GD is all-or-nothing: one short item anywhere in the merged lines blocks the
// whole document, so none of the selected SOs convert. Say so, and point at the way out.
const gdType = {{workflowparams:gd_type}};
const soIds = {{workflowparams:so_ids}} || [];
const isCombined = gdType === "single" && soIds.length > 1;

const created = [];
const blocked = [];
const queued = [];

for (const r of results) {
  // V2: queued with a job id (the worker creates it; the SO list follows the job), or refused before any job was made
  if (r.route === "V2") {
    if (r.code || !r.job_id) {
      let detail = "";
      try {
        const errs = JSON.parse(r.line_errors || "[]");
        if (Array.isArray(errs) && errs.length) {
          detail =
            " (" +
            errs
              .slice(0, 3)
              .map((e) => (e.line_no ? "Line " + e.line_no : "Header") + ": " + (e.message || e.code))
              .join("; ") +
            (errs.length > 3 ? "; ..." : "") +
            ")";
        }
      } catch (e) {}
      const again = r.code === "GD_V2_USE_CLASSIC" ? " Convert it again: it is then saved the classic way." : "";
      blocked.push({ so_no: r.so_no, reason: (r.message || r.code || "The goods delivery could not be submitted.") + detail + again });
    } else {
      queued.push({ so_no: r.so_no, job_id: r.job_id, gd_no: r.gd_no || "" });
    }
    continue;
  }
  if (r.code === "200" && r.gd_id) {
    created.push({ so_no: r.so_no, delivery_no: r.delivery_no || "" });
  } else {
    let reason = r.message || "Failed to create the Goods Delivery.";
    if (isCombined) {
      reason +=
        " No goods delivery was created for any of these sales orders. Retry as Multiple GDs to convert the ones that have enough stock.";
    }
    blocked.push({ so_no: r.so_no, reason: reason });
  }
}

// SOs dropped before we ever called GDheadWorkflow (nothing left to deliver), or by the V2 plan (too many lines).
const preBlocked = ({{node:code_build.data.blocked}} || []).concat([{{node:code_v2plan.data.blocked}}][0] || []);
for (const b of preBlocked) {
  blocked.push(b);
}

return {
  code: "200",
  message:
    "Created " +
    created.length +
    " goods deliver" +
    (created.length === 1 ? "y" : "ies") +
    (queued.length > 0 ? ", " + queued.length + " being created in the background" : "") +
    (blocked.length > 0 ? ", " + blocked.length + " not converted." : "."),
  created: created,
  blocked: blocked,
  queued: queued,
  createdCount: created.length,
  blockedCount: blocked.length,
  queuedCount: queued.length,
};
