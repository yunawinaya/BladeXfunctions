// The saved PO as it stands now (after approval, if any): the header fields the rest of the workflow reads, typed as the
// get-node handed them on (ids and text as strings, auto_pi / po_total as numbers, preq_id as an array of id strings).
const rows = [{{node:sql_po_head.data}}][0];
const r = (Array.isArray(rows) ? rows[0] : rows) || {};
if (!r.id) throw new Error("PO_SAVE: the saved purchase order " + {{node:code_get_latest.data.poIdSql}} + " could not be read back");
const text = (v) => (v === undefined || v === null ? undefined : String(v));
const num = (v) => (v === undefined || v === null || v === "" ? undefined : Number(v));
// JSON_ARRAYAGG of the ids as text: arrives as JSON text (or already parsed)
let preq = r.preq_id_json;
if (typeof preq === "string") preq = preq ? JSON.parse(preq) : [];
const poData = {
  id: text(r.id),
  purchase_order_no: text(r.purchase_order_no),
  po_status: text(r.po_status),
  po_plant: text(r.po_plant),
  organization_id: text(r.organization_id),
  po_supplier_id: text(r.po_supplier_id),
  preq_id: (Array.isArray(preq) ? preq : []).map(String),
  po_total: num(r.po_total),
  auto_pi: num(r.auto_pi),
  create_pi: text(r.create_pi),
};

// SQL-safe forms of the keys Get On Order Lines / Items / Existing On Order interpolate: digits only, the PO number as hex
const digits = (v) => (/^[0-9]{1,19}$/.test(String(v || "")) ? String(v) : "0");
const hex = (s) => {
  let e = "";
  try {
    e = encodeURIComponent(String(s || ""));
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

return { poData: poData, poIdSql: digits(poData.id), orgSql: digits(poData.organization_id), poNoHex: hex(poData.purchase_order_no) };
