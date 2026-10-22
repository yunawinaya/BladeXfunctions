// GD_BULK_COMMIT - P7E_REORDER check: the STARTED row read back -> DONE (REORDER answered without failing the run)
// the DB clock now: the pass's start (dbNow) + the seconds it has run so far
const endNow = (e) => {
  const m = String((e && e.dbNow) || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m || !(Number(e.jsAt) > 0)) return e ? e.dbNow : "";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + Math.max(0, Math.floor((Date.now() - Number(e.jsAt)) / 1000)) * 1000);
  const p = (n) => (n < 10 ? "0" : "") + n;
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
};
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const plan = [{{node:code_node_P7Eplan0.data}}][0] || {};
const back = [{{node:sql_node_P7Eback0.data}}][0];
const st = (Array.isArray(back) ? back : back ? [back] : []).filter((r) => r && s(r.kind) === "STEP" && s(r.k) === "P7E_REORDER" && s(r.id))[0] || null;
const done = !!st && s(st.v) === "STARTED";
const stepDoneRows = done ? [{ id: s(st.id), step_status: "DONE", attempt_count: Number(st.n) || 1, finished_at: s(endNow(plan)), inventory_operation_id: s(st.x), result_ref: s(plan.rowCount) + " lines", error_code: null, error_message: null }] : [];
const why = !st ? "P7E row not found after its insert (left as is)" : done ? "DONE" : "P7E row is " + s(st.v);
console.log("publish P7E check", JSON.stringify({ done: done, why: why }));
return { publish_route: done ? "DONE" : "SKIP", needStepUpd: done ? "YES" : "NO", stepDoneRows: stepDoneRows, result_message: why };
