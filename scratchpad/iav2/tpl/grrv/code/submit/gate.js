// GR_REVERT_SUBMIT - Gate (code_node_VSgate): grRvPrep (lifted, prep.js) on the stored receipt as GR_REVERT_COMPLETED would
// read it -> STOP 400 with its refusal (same texts; its own "more than 500 lines" guard is not V2's); what V2 does not take -
// a handling unit in the receipt's chain, a serial-managed item - NOT_ELIGIBLE (-> the classic GR_REVERT_COMPLETED) up to the
// classic's 500 lines, STOP above; STOP above V2's 2,500 lines; else GO with the line count and the status it starts from.
// Self-contained (rv* helpers from adapter.js / prep.js): it does not need submit/_common.js
const rvGate = function rvGate(entry, S) {
  const e = entry || {};
  const answer = (route, code, message, extra) => Object.assign({ route: route, code: String(code), message: message || "", reason: "", lineCount: 0, previousStatus: "" }, extra || {});
  if (rvS(e.route) !== "GO") return answer("STOP", rvS(e.code) || "400", rvS(e.message) || "the Goods Receiving cannot be reverted");
  if (!rvDigits(e.grId) || !rvDigits(e.organizationId)) return answer("STOP", "400", "The Goods Receiving has no valid organization or plant.");
  const A = rvAdapt1(S);
  // get_node_grRvGr reads the receipt of the request's organization
  const gr = A.hdr && A.hdr.id && rvS(A.hdr.organization_id) === rvS(e.organizationId) ? A.hdr : null;
  const p = rvRunPrep(gr, A.movs, { grId: e.grId, grNo: gr ? rvS(gr.gr_no) : rvS(e.grNo), organizationId: e.organizationId }).prep;
  const n = rvList(p.lines).length;
  const extra = { lineCount: n, previousStatus: gr ? rvS(gr.gr_status) : "" };
  if (Number(p.refuse) === 1) return answer("STOP", "400", rvS(p.refuseMessage), extra);
  const why = rvHasHu(p) ? "it has handling units" : A.serialLines > 0 ? "it has serial-numbered items" : "";
  if (why && n > RV_OLD_PATH_LINES) {
    return answer("STOP", "400", "This Goods Receiving has " + n + " lines and cannot be reverted in the background (" + why + "); the classic revert handles at most "
      + RV_OLD_PATH_LINES + " lines.", Object.assign({ reason: why }, extra));
  }
  if (why) return answer("NOT_ELIGIBLE", "300", why, Object.assign({ reason: why }, extra));
  if (n > RV_MAX_LINES) return answer("STOP", "400", "This Goods Receiving has " + n + " lines. Reverting more than " + RV_MAX_LINES + " lines is not supported.", extra);
  return answer("GO", "", "", extra);
};
