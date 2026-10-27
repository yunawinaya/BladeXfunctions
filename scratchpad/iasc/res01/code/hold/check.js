// IA_HOLD - BA rev 1.2 C2: CHECK, how a completed IA's completion ended, from its own claims (the effect identity): the latest claim that
// did not lose to another (by number) decides - DONE (the normal save finished) or V2 (the background completion, which writes Completed
// only after its effects) is fine; PARTIAL|<step> means an issue or the receipt was refused after the header said Completed; HELD past
// the 10-minute lease means the run stopped before finishing; a claim freed with no outcome (before the markers) is UNKNOWN, never DONE.
// Read-only: a person reconciles from the IA's stock movements
const HD_CHECK_TEXT = {
  SUBTRACT: "This completion stopped while issuing its components (an issue was refused after the Item Assembly was marked Completed): some components may not be issued.",
  RECEIPT: "This completion stopped at the output receipt: its components are issued but the output may not be received.",
  INTERRUPTED: "This completion was interrupted (it stopped before finishing): some components may not be issued or the output not received.",
  RUNNING: "This completion is still running: open it again in a moment.",
};
const HD_REVIEW = " Needs review: check this Item Assembly's stock movements before correcting it.";
const hdCheck = function hdCheck(g, rows) {
  const st = hdSqlRow(rows) || {};
  if (hdS(st.org) !== "" && hdS(st.org) !== hdS(g.org)) return { code: "400", message: "This Item Assembly belongs to another organisation.", result_json: "" };
  const done = { code: "200", message: "", result_json: "" };
  const out = (outcome, step, message) => Object.assign({}, done, { message: message, result_json: JSON.stringify({ outcome: outcome, step: step || "", message: message }) });
  const status = hdS(st.status);
  if (status !== "Completed" && status !== "Fully Posted") return out("NOT_COMPLETED", "", "");
  const claims = (Array.isArray(st.claims) ? st.claims : []).filter((c) => c && hdS(c.ref) !== "LOST").sort((a, b) => hdNum(b.n) - hdNum(a.n));
  const last = claims[0];
  if (!last) return out("NONE", "", "");
  const ref = hdS(last.ref);
  if (hdS(last.status) === "HELD") {
    const now = Date.parse(hdS(st.now).replace(" ", "T") + "Z");
    const at = Date.parse(hdS(last.at).replace(" ", "T") + "Z");
    return now - at < HD_LEASE_MS ? out("RUNNING", "", HD_CHECK_TEXT.RUNNING) : out("INTERRUPTED", "", HD_CHECK_TEXT.INTERRUPTED + HD_REVIEW);
  }
  if (ref.indexOf("PARTIAL|") === 0) {
    // IA output split (IA_SAVE v14): RECEIPT|<k>/<n> = output row k of n refused (0 = its batches were not created)
    const parts = ref.slice(8).split("|");
    const step = parts[0];
    const kn = /^([0-9]+)\/([0-9]+)$/.exec(parts[1] || "");
    const k = kn ? Number(kn[1]) : 0;
    const split = !kn ? "" : k === 0 ? " Split receipt (" + kn[2] + " rows): its output batches could not be created; no output row was received." :
      " Split receipt: output row " + k + " of " + kn[2] + " was refused; " + (k > 1 ? "rows 1 to " + (k - 1) + " were received." : "no output row was received.");
    return out("PARTIAL", step, (HD_CHECK_TEXT[step] || "This completion did not finish.") + split + HD_REVIEW);
  }
  return ref === "DONE" || ref === "V2" ? out("DONE", "", "") : out("UNKNOWN", "", "");
};
const res = hdCheck([{{node:code_node_HDguard.data}}][0] || {}, [{{node:sql_node_HDcheck.data}}][0]);
console.log("hold check", res.result_json || res.message);
return res;
