// GD_CANCEL_SUBMIT - Gate: the stored GD (PREPARE's reads + gdc's adapter), what GD_CANCEL_PREPARE refuses that can be told from
// the stored rows (-> the classic cancel), then GOODS_DELIVERY's cancel gates up to CHECK_REQUIRED_FIELD in its order (gxChain
// gatesOnly, lifted) and the box cap of the unpack (GX_MAX_BOXES, the boxes of its open Packings that still hold stock)
const GXS_MAX_BOXES = 300;
const cancelGate = function cancelGate(guard, entry, S) {
  const n = num(entry.lineCount);
  const base = { route: "STOP", code: "", message: "", reason: "" };
  const R = gcAdapt(S);
  if (!R.gd.count) return Object.assign(base, answer("STOP", "400", "Goods Delivery not found"));
  const stored = R.gd.data;
  if ((R.serialItems || []).length) return Object.assign(base, notEligible("it has serial-numbered items", n));
  if (num(stored.is_select_picking) === 1) return Object.assign(base, notEligible("it was created from a Picking", n));
  stored.gd_status = "Created";
  const out = gxChain({ params: gxParams(stored), reads: R, tenantId: guard.tenantId, uuid: "GXS" + guard.gdId, kinds: GC_KINDS, gatesOnly: true });
  if (out.route === "NOT_ELIGIBLE") return Object.assign(base, notEligible(out.message, n));
  if (out.route !== "GATES") return Object.assign(base, answer("STOP", out.code, out.message));
  // if_KTzHecEc: CHECK_REQUIRED_FIELD runs on a cancel too
  const req = gsRequired(out.gates.eidData, out.gates.eidFields);
  if (req.status === "Failed") return Object.assign(base, answer("STOP", "400", req.message));
  // the open Packings' boxes that still hold stock (what X4H unloads, one REPACKING_PROCESS run each)
  const rows = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r && r.j);
  const open = {};
  const boxes = [];
  for (const r of rows(S.pack)) {
    const o = gcParse(r.j);
    if (s(r.k) === "H" && ["Completed", "Cancelled"].indexOf(s(o.packing_status)) < 0) open[s(o.id)] = true;
    if (s(r.k) === "U" && s(o.hu_row_type) === "generated" && digits(o.handling_unit_id)) boxes.push(o);
  }
  const stocked = {};
  for (const r of rows(S.box)) if (s(r.k) === "HI") stocked[s(gcParse(r.j).handling_unit_id)] = true;
  const toUnpack = boxes.filter((b) => open[s(b.packing_id)] && stocked[s(b.handling_unit_id)]).length;
  if (toUnpack > GXS_MAX_BOXES) return Object.assign(base, answer("STOP", "400", "Its open Packing has " + toUnpack + " packed boxes; a cancel unpacks at most " + GXS_MAX_BOXES + ". Unpack some boxes in the Packing first."));
  return Object.assign(base, answer("GO", "", ""));
};
