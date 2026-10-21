// IA_REVERT_V2_COMMIT - V4 plan: Draft -> done; Processing under this job -> write Draft (the unlock); else REVIEW
const commitV4Plan = function commitV4Plan(entry, hdrRows, iaRowsNow) {
  const base = { route: "GO", headerRows: [], needHeader: "NO", after: {}, jobRows: [], needJobUpd: "NO", result_code: "", result_message: "", job_status: "COMMITTING_REVERT" };
  const h = iaJoinChunks(hdrRows, entry.partPrefix + "HDR|");
  if (!h || typeof h !== "object" || s(h.id) !== entry.iaId || !h.after || s(h.after.item_assembly_status) !== "Draft") {
    return Object.assign(base, stepEnd(entry, "V4_FINISH", "the HDR part of the prepared payload is missing or is not this Item Assembly's", true));
  }
  const ia = list(iaRowsNow)[0] || null;
  base.after = h.after;
  if (!ia) return Object.assign(base, stepEnd(entry, "V4_FINISH", "the Item Assembly cannot be read", false));
  const st = s(ia.item_assembly_status);
  if (st === "Draft") return Object.assign(base, { result_message: "the Item Assembly is already Draft" });
  const mine = st === "Processing" && s(ia.ia_v2_job_id) === entry.jobId && s(ia.lock_ref) !== "" && s(ia.lock_ref) === entry.idempotencyKey;
  if (!mine) return Object.assign(base, stepEnd(entry, "V4_FINISH", "the Item Assembly is " + (st || "blank") + ", not Processing under this revert", true));
  return Object.assign(base, { headerRows: [Object.assign({ id: entry.iaId }, h.after)], needHeader: "YES", result_message: "the Item Assembly back to Draft" });
};
const res = commitV4Plan([{{node:code_node_IVCentry.data}}][0], [{{node:sql_node_IVCv4part.data}}][0], [{{node:sql_node_IVCv4now.data}}][0]);
console.log("commit V4 plan", JSON.stringify({ route: res.route, header: res.needHeader, result: res.result_code, message: res.result_message }));
return res;
