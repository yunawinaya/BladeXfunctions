// GR_COMPLETE_SUBMIT - Gate: what the background completion does not take (-> the classic save, or STOP above its 500-line
// guard), then GOODS_RECEIVING's gates before its first write, lifted, on the FORM's data (grGates: mlTvKeIR 401,
// 4r2Fv9G5 400, CHECK_REQUIRED_FIELD, Ga3BZDyy 400, e9pINRwN 400 - same codes, same texts) -> the filled-back receipt
const rsEligibility = function rsEligibility(form, items, n, poLines) {
  if (n > MAX_V2_LINES) return answer("STOP", "400", "This Goods Receiving has " + n + " lines; one completion takes at most " + MAX_V2_LINES + " lines. Split it into smaller receipts.");
  const byId = {};
  for (const i of items) byId[s(i.id)] = i;
  const arr = (t) => {
    if (!t) return [];
    if (Array.isArray(t)) return t;
    try {
      const a = JSON.parse(t);
      return Array.isArray(a) ? a : [];
    } catch (e) {
      return [];
    }
  };
  for (const r of (Array.isArray(form.table_gr) ? form.table_gr : [])) if (s(r.item_bundle_id) || (Array.isArray(r.children) && r.children.length)) return notEligible("it has item bundles", n);
  const negativePo = {};
  for (const l of poLines || []) if (num(l.po_amount) < 0 || num(l.unit_price) < 0) negativePo[s(l.id)] = true;
  for (const r of flatRows(form.table_gr)) {
    if (s(r.is_split) === "Yes" || s(r.parent_or_child) === "Child") return notEligible("it has split lines", n);
    if (num(r.unit_price) < 0 || negativePo[s(r.po_line_item_id)]) return notEligible("it has lines with a negative price", n);
    if (arr(r.temp_hu_data).length || s(r.handling_unit_id)) return notEligible("it has handling units", n);
    if (s(r.inv_category) === "Quality Inspection" || s(r.inspection_required) === "Yes") return notEligible("it receives into quality inspection", n);
    const it = byId[s(r.item_id)];
    if (!it) continue;
    if (num(it.serial_number_management) === 1) return notEligible("it has serial-numbered items", n);
    if (num(it.receiving_inspection) === 1) return notEligible("it has items that need receiving inspection", n);
  }
  return null;
};
const submitGate = function submitGate(guard, entry, keys, S, form, busy) {
  const base = { route: "STOP", code: "", message: "", reason: "", allData: {}, grStatus: "" };
  if (!form || typeof form !== "object" || !Array.isArray(form.table_gr)) return Object.assign(base, answer("STOP", "400", "the form's data was not sent"));
  if (s(keys.ok) !== "YES") return Object.assign(base, answer("STOP", "400", s(keys.why)));
  // another receipt of one of its purchase orders is still Processing: its quantities are not written yet
  const busyText = poBusyMessage(busy, false);
  if (busyText) return Object.assign(base, answer("STOP", "400", busyText));
  const R = grAdapt(S);
  const n = num(keys.lineCount);
  const why = rsEligibility(form, R.items.data, n, R.poLines);
  if (why) return Object.assign(base, why);
  // the stored status decides the number and the reservation release, never the form's copy
  if (guard.pageStatus === "Edit") form.previous_status = entry.grStatus;
  const out = grGates({ form: form, pageStatus: guard.pageStatus, continueZero: guard.answers.continueZero, reads: R, tenantId: guard.tenantId });
  if (s(out.route) !== "GO") return Object.assign(base, answer("STOP", s(out.code) || "400", s(out.message)));
  return Object.assign(base, answer("GO", "", ""), { allData: out.allData, grStatus: s(out.gr_status) });
};
