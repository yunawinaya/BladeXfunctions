// GD_CANCEL_COMMIT - X0 ids: the reservations the RES part updates, the Pickings and Packings the cancel writes, the boxes it
// unpacks (for the fresh reads)
const e = [{{node:code_node_XCentry.data}}][0];
const parts = [{{node:sql_node_XCx0parts.data}}][0];
const res = joinChunks(parts, e.partPrefix + "RES|");
const pick = joinChunks(parts, e.partPrefix + "PICK|");
const pack = joinChunks(parts, e.partPrefix + "PACK|");
const hu = joinChunks(parts, e.partPrefix + "HU|");
const ok = !!(res && pick && pack && hu);
const ids = (xs) => Array.from(new Set(xs.map(s).filter(digits)));
const resIds = ok ? ids((res.updates || []).map((u) => u.id)) : [];
const pickIds = ok ? ids((pick.rows || []).map((r) => r.picking_id).concat((pick.headers || []).map((h) => h.id))) : [];
const packIds = ok ? ids((pack.headers || []).map((h) => h.id).concat((pack.lines || []).map((l) => l.packing_id))) : [];
const boxIds = ok ? ids((hu.boxes || []).map((b) => b.hu_id)) : [];
const j = (xs) => JSON.stringify(xs.length ? xs : ["0"]);
console.log("commit X0 ids", JSON.stringify({ ok: ok, reservations: resIds.length, pickings: pickIds.length, packings: packIds.length, boxes: boxIds.length }));
return { ok: ok ? "YES" : "NO", idsJson: j(resIds), pickIdsJson: j(pickIds), packIdsJson: j(packIds), boxIdsJson: j(boxIds) };
