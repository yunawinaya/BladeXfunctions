// IA_SAVE v14 - a split's header: its single Output Location fields = row 1 (osHeader; single-value readers keep working, item_qty stays
// the total), written right after the header write once the IA's id is known
const f = [{{node:code_node_OSfinal.data}}][0] || {};
const p = [{{node:code_persisted.data}}][0] || {};
const a = [{{node:code_fillback.data.allData}}][0] || {};
const h = osHeader(f.output_split || [], a, f.kind);
return { need: f.split === "YES" && osS(p.docId) !== "" ? "YES" : "NO", id: osS(p.docId), storage_location_id: h.storage_location_id, location_id: h.location_id,
  inventory_category: h.inventory_category, batch_no: h.batch_no, manufacturing_date: h.manufacturing_date || null, expired_date: h.expired_date || null };
