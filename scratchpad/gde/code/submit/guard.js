// GD_EDIT_SUBMIT - Guard: operation, gd_id (digits), source (FORM: the form's allData; CASCADE: SO_CASCADE's payload or a
// delta, + cascade_ref), the answers the classic save's prompts give (needCL, continueZero, confirmPickReversal), session
// tenant + user; and the ids the edit brings (materials, SO lines, SOs) as digit lists, so every read covers the GD as stored
// AND the edit. RELEASE / CANCEL_HELD: a Sales Order save's own held job on this GD, by its cascade_ref
const submitGuard = function submitGuard(inp) {
  const op = s(inp.operation).toUpperCase() || "SUBMIT";
  const gdId = s(inp.gdId);
  const source = s(inp.source).toUpperCase() || "FORM";
  const tenantId = s(inp.tenantId);
  const cascadeRef = s(inp.cascadeRef);
  const bad = (why) => answer("REJECT", "400", why, { operation: op, gdId: "0", tenantId: "0", source: source, cascadeRef: "", uid: "", answers: {}, idLists: {} });
  if (["SUBMIT", "STATUS", "RELEASE", "CANCEL_HELD"].indexOf(op) < 0) return bad("operation must be SUBMIT, STATUS, RELEASE or CANCEL_HELD");
  if (!digits(gdId)) return bad("gd_id: digits only");
  if (["FORM", "CASCADE"].indexOf(source) < 0) return bad("source must be FORM or CASCADE");
  if (!digits(tenantId)) return bad("no session tenant");
  const parse = (v) => { if (typeof v !== "string") return v; try { return JSON.parse(v); } catch (e) { return null; } };
  let a = parse(inp.answers);
  a = a && typeof a === "object" ? a : {};
  const form = parse(inp.form), delta = parse(inp.delta);
  const hasForm = !!form && Array.isArray(form.table_gd), hasDelta = !!delta && Array.isArray(delta.layout);
  // the cascade releases / cancels its held jobs by this reference; it reaches SQL and the job's request
  if (cascadeRef && !/^[A-Za-z0-9|:_.-]{1,80}$/.test(cascadeRef)) return bad("cascade_ref: letters, digits and | : _ . - only (at most 80)");
  if ((op === "RELEASE" || op === "CANCEL_HELD") && !cascadeRef) return bad("cascade_ref is required for " + op);
  if (op === "SUBMIT" && source === "FORM" && !hasForm) return bad("the form's data was not sent");
  if (op === "SUBMIT" && source === "CASCADE" && !hasForm && !hasDelta) return bad("the edit (its payload or a delta) was not sent");
  if (op === "SUBMIT" && source === "CASCADE" && !cascadeRef) return bad("cascade_ref is required for a cascade submit");
  // the ids of the edit: every line the payload holds (or the delta adds / changes)
  const useForm = source === "FORM" || hasForm;
  const rows = useForm ? (hasForm ? form.table_gd : []).flatMap((r) => [r].concat(r.children || []))
    : (delta ? (delta.added || []).concat((delta.lines || []).map((l) => l.cells || {})) : []);
  const ids = (k) => [...new Set(rows.map((r) => s(r[k])).filter(digits))];
  const soIds = new Set(ids("line_so_id"));
  const hdrSo = useForm ? (form || {}).so_id : ((delta || {}).header || {}).so_id;
  for (const x of Array.isArray(hdrSo) ? hdrSo : hdrSo ? [hdrSo] : []) if (digits(x)) soIds.add(s(x));
  const sql = (arr) => (arr.length ? arr.join(",") : "0");
  const soLines = ids("so_line_item_id");
  return answer("CONTINUE", "", "", {
    operation: op, gdId: gdId, tenantId: tenantId, source: source, cascadeRef: cascadeRef, uid: s(inp.uid), answers: { needCL: s(a.needCL) || "required", continueZero: s(a.continueZero), confirmPickReversal: s(a.confirmPickReversal) },
    idLists: Object.assign({ deltaMaterialIdsSql: sql(ids("material_id")), deltaSoLineIdsSql: sql(soLines), deltaSoLineIdsQuoted: soLines.length ? soLines.map((x) => "'" + x + "'").join(",") : "'0'", deltaSoIdsSql: sql([...soIds]) },
      useForm ? geAllocIds(rows, []) : geAllocIds((delta || {}).added, (delta || {}).lines)),
  });
};
