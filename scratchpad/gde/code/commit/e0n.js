// GD_EDIT_COMMIT - E0N NUMBER (a Draft saved as Created): the header's delivery_no written 'issued' with its serial rule
// (update_node_aJCo6wbf's numbering: the platform issues a serial on that write), ONCE. An intent row keeps the number
// and rule before; a re-run that finds the intent and no DONE re-reads and adopts a number that already changed.
// Before E1 a failure puts the before-image back (E1's restore; the serial issued stays a gap).
const commitE0NPlan = function commitE0NPlan(entry, gdh, headRows, intentRows) {
  const base = { route: "GO", writeRows: [], needWrite: "NO", intentRows: [], needIntent: "NO", stepRows: [], needStep: "NO", result_code: "", result_message: "" };
  const n = (gdh || {}).numbering;
  const head = list(headRows).map((r) => (typeof r.j === "string" ? parseJ(r.j) : r))[0] || null;
  if (!head) return Object.assign(base, stepEnd(entry, "E0N_NUMBER", "the Goods Delivery cannot be read", true));
  if (!n || Number(n.issue) !== 1) return Object.assign(base, { route: "DONE", stepRows: [doneRow(entry, "E0N_NUMBER", s(head.delivery_no))], needStep: "YES", result_message: "no number to issue" });
  const intent = joinChunks(intentRows, "E0N|I|");
  if (intent === undefined) return Object.assign(base, stepEnd(entry, "E0N_NUMBER", "the recorded intent cannot be read", true));
  if (intent && s(head.delivery_no) !== s(intent.delivery_no) && s(head.delivery_no) !== "issued")
    return Object.assign(base, { route: "DONE", stepRows: [doneRow(entry, "E0N_NUMBER", s(head.delivery_no))], needStep: "YES", result_message: "number " + s(head.delivery_no) + " already issued" });
  const before = intent || { delivery_no: head.delivery_no === undefined ? null : head.delivery_no, delivery_no_type: head.delivery_no_type === undefined ? null : head.delivery_no_type };
  return Object.assign(base, {
    intentRows: intent ? [] : chunkRows(entry, "E0N|I|", before), needIntent: intent ? "NO" : "YES",
    writeRows: [{ id: entry.gdId, delivery_no: "issued", delivery_no_type: n.delivery_no_type === undefined ? null : n.delivery_no_type }], needWrite: "YES",
    result_message: "issue a number (was " + s(before.delivery_no) + ")",
  });
};
const commitE0NCheck = function commitE0NCheck(entry, headRows, intentRows) {
  const head = list(headRows).map((r) => (typeof r.j === "string" ? parseJ(r.j) : r))[0] || {};
  const intent = joinChunks(intentRows, "E0N|I|") || {};
  const no = s(head.delivery_no);
  if (!no || no === "issued" || no === s(intent.delivery_no)) return stepEnd(entry, "E0N_NUMBER", "the number did not read back (delivery_no " + (no || "empty") + ")", false);
  return stepOk(entry, "E0N_NUMBER", no, "number " + no + " issued");
};
