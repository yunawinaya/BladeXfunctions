// IA_HOLD - Plan: refusals (FIX-03 membership, status, enrolment), the mutex (another live run = BUSY), what an unfinished run
// left (Processing / Releasing rows: their operations are looked up next); CLOSE (after completion) also reads what the completion
// issued from Reserved
// the IA number for SQL text: the upper-case hex of its UTF-8 bytes (as PO_SAVE sends the PO number); '' when it has no UTF-8 form
const hdHex = function hdHex(text) {
  let e = "";
  try {
    e = encodeURIComponent(text);
  } catch (err) {
    return "";
  }
  let h = "";
  for (let i = 0; i < e.length; i++) {
    if (e[i] === "%") {
      h += e.substr(i + 1, 2);
      i += 2;
    } else {
      h += ("0" + e.charCodeAt(i).toString(16)).slice(-2);
    }
  }
  return h.toUpperCase();
};
const hdPlan = function hdPlan(g, st, member) {
  const stop = (code, why) => ({ route: "STOP", code: code, message: why, needOps: "NO", opsJson: "[]", now: hdS(st && st.now), needConsumed: "NO", noHex: "", badNo: "NO" });
  const ia = st && st.ia;
  // a deleted IA can only be released: the list deletes the header first, so no reservation starts for it any more (review M4)
  if (!ia || (Number(ia.is_deleted) === 1 && g.op !== "RELEASE_ALL")) return stop("400", "Item Assembly not found.");
  if (hdS(ia.organization_id) !== hdS(g.org)) return stop("400", "This Item Assembly belongs to another organisation.");
  if (!(Number(member) > 0)) return stop("400", "Your user is not assigned to this organisation, so this Item Assembly's materials cannot be reserved.");
  const status = hdS(ia.status);
  if (status === "Processing") return stop("409", "This Item Assembly is being completed in the background: its materials are not changed now.");
  // reserved requests (Item Assembly & BOM/TransferRequest/RESERVED_REQUEST_DESIGN.md): a dispatched request carries this IA's
  // reservation; nothing is changed here until it is received (else the old bins would be reserved again)
  const transit = st.transit && typeof st.transit === "object" ? st.transit : null;
  if (transit && hdS(transit.id)) {
    return stop("409", "In transit (" + (hdS(transit.no) || hdS(transit.id)) + "): the reservation travels with the transfer request; nothing is changed until it is received.");
  }
  const rows = Array.isArray(st.rows) ? st.rows : [];
  const closing = g.op === "CLOSE";
  // CANCEL (user 10-22, like Goods Delivery): a Created IA only; everything it holds is released, then it is Cancelled (finish)
  if (g.op === "CANCEL" && status === "Cancelled") return stop("200", "Already cancelled.");
  if (g.op === "CANCEL" && status !== "Created") {
    return stop("400", status === "Draft" ? "A Draft is deleted, not cancelled." : "Only a Created Item Assembly can be cancelled (it is " + (status || "without a status") + ").");
  }
  if (closing && status !== "Completed" && status !== "Fully Posted") return stop("200", "Nothing to close: the Item Assembly is " + (status || "without a status") + ".");
  // RES-01 Created (BA, 10-22): a Created IA reserves; a Draft only gives back what it may still hold (delta / finish)
  if (!closing && status !== "Draft" && status !== "Created" && !(g.op === "RELEASE_ALL" && status === "Cancelled")) return stop("200", "Nothing to reserve: the Item Assembly is " + (status || "without a status") + ".");
  if (closing && !rows.length) return stop("200", "Nothing held: there is nothing to close.");
  if (g.op === "RECONCILE" && !hdS(ia.hold) && !rows.length) return stop("200", "Not enrolled: this Item Assembly does not reserve its materials.");
  const now = Date.parse(hdS(st.now).replace(" ", "T") + "Z");
  const live = (Array.isArray(st.held) ? st.held : []).filter((t) => now - Date.parse(hdS(t.started_at).replace(" ", "T") + "Z") < HD_LEASE_MS);
  if (live.length) return stop("409", "Another reservation of this Item Assembly is running: try again in a moment.");
  const ops = hdOpsOf(rows);
  // CLOSE reads by the IA number, which reaches SQL only as hex: any number can be read (review M6); none, or one with no UTF-8
  // form, cannot (Needs review)
  const noHex = closing ? hdHex(hdS(ia.no)) : "";
  return { route: "GO", code: "200", message: "", needOps: ops.length ? "YES" : "NO", opsJson: JSON.stringify(ops), now: hdS(st.now),
    needConsumed: closing && noHex ? "YES" : "NO", noHex: noHex, badNo: closing && !noHex ? "YES" : "NO" };
};
const res = hdPlan([{{node:code_node_HDguard.data}}][0] || {}, hdSqlRow([{{node:sql_node_HDstate.data}}][0]), (hdSqlRow([{{node:sql_node_HDmember.data}}][0]) || {}).member);
console.log("hold plan", JSON.stringify({ route: res.route, code: res.code, message: res.message, ops: res.opsJson }));
return res;
