// sql-node mocks for the lean conversions (and PI_SAVE's are in world.js): rows of JSON text built from a World's documents,
// the columns each lean sql-node selects. module.exports = (world) => ({ <node id>: (sqlText) => rows })
"use strict";

const COLS = {
  GR_HEAD: ("id gr_status po_id supplier_name plant_id gr_no gr_remark1 gr_remark2 gr_remark3 gr_remark4 gr_remark5 currency_code billing_address_name " +
    "billing_address_phone billing_address_line_1 billing_address_line_2 billing_address_line_3 billing_address_line_4 billing_address_city " +
    "billing_postal_code billing_address_state billing_address_country billing_attention billing_address_fax shipping_address_name " +
    "shipping_address_phone shipping_address_line_1 shipping_address_line_2 shipping_address_line_3 shipping_address_line_4 shipping_address_city " +
    "shipping_postal_code shipping_address_state shipping_address_country shipping_attention shipping_address_fax gr_billing_address " +
    "gr_shipping_address organization_id purchase_order_number project_id custom_fields_e9609s2l").split(" "),
  GR_LINE: ("id item_id item_name item_bundle_id item_desc more_desc line_po_no received_qty item_uom line_remark_1 line_remark_2 line_po_id " +
    "po_line_item_id item_category_id billing_country_id shipping_country_id billing_state_id supplier_id tariff_id further_description " +
    "project_id custom_fields_d7o7rdkd parent_or_child parent_id").split(" "),
  PO_HEAD: ("id exchange_rate exchange_rate_currency po_status approve_flow_status purchase_order_no po_supplier_id po_currency po_plant " +
    "organization_id acc_integration_type po_payment_terms po_description po_remark po_remark2 po_remark3 po_remark4 po_remark5 " +
    "po_billing_address po_shipping_address billing_address_name billing_address_phone billing_address_line_1 billing_address_line_2 " +
    "billing_address_line_3 billing_address_line_4 billing_address_city billing_postal_code billing_address_state billing_address_country " +
    "billing_attention billing_address_fax shipping_address_name shipping_address_phone shipping_address_line_1 shipping_address_line_2 " +
    "shipping_address_line_3 shipping_address_line_4 shipping_address_city shipping_postal_code shipping_address_state " +
    "shipping_address_country shipping_attention shipping_address_fax project_id custom_fields_b3w85tmv").split(" "),
  PO_LINE: ("id parent_id quantity unit_price discount discount_amount tax_amount po_amount discount_uom tax_preference tax_percent tax_inclusive " +
    "invoice_qty payment_term_id item_id item_name item_bundle_id item_desc more_desc received_qty quantity_uom line_remark_1 line_remark_2 " +
    "item_category_id tariff_id further_description project_id custom_fields_va4w0xz3").split(" "),
  GR_PO_HEAD: ["id", "exchange_rate", "exchange_rate_currency"],
  GR_PO_LINE: ("id quantity unit_price discount discount_amount tax_amount po_amount discount_uom tax_preference tax_percent tax_inclusive " +
    "invoice_qty payment_term_id").split(" "),
};

const idsIn = (text, after) => {
  const i = text.indexOf(after);
  if (i < 0) throw new Error("no " + after);
  const m = text.slice(i + after.length).match(/^\s*\(([0-9,\s]*)\)/);
  return m[1].split(",").map((x) => x.trim()).filter((x) => x && x !== "0");
};
const row = (src, cols, doc) => {
  const o = doc === undefined ? {} : { doc: doc };
  for (const c of cols) o[c] = src[c] === undefined ? null : src[c];
  return { j: JSON.stringify(o) };
};
const byId = (a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0);

module.exports = function sqlMocks(w) {
  // the statuses the sql-node's text asks for (v19: Completed; v21: Completed or Received)
  const statusesOf = (text) => (/gr_status IN \(([^)]*)\)/.test(text) ? text.match(/gr_status IN \(([^)]*)\)/)[1].split(",").map((x) => x.trim().replace(/'/g, "")) : ["Completed"]);
  const grDocs = (text, completed) => idsIn(text, "g.id IN").filter((id) => w.gr[id] && (!completed || statusesOf(text).includes(w.gr[id].header.gr_status)))
    .sort((a, b) => byId({ id: a }, { id: b }));
  const lines = (doc) => doc.lines.slice().sort(byId);
  return {
    sql_node_grcvHeads: (t) => grDocs(t, false).map((id) => row(w.gr[id].header, ["id", "gr_status", "po_id"])),
    sql_node_grcvDone: (t) => grDocs(t, true).map((id) => row(w.gr[id].header, COLS.GR_HEAD)),
    sql_node_grcvLines: (t) => [].concat(...grDocs(t, true).map((id) => lines(w.gr[id]).map((l) => row(l, COLS.GR_LINE, id)))),
    sql_node_grcvPoHeads: (t) => idsIn(t, "p.id IN").filter((id) => w.po[id]).sort((a, b) => byId({ id: a }, { id: b })).map((id) => row(w.po[id].header, COLS.GR_PO_HEAD)),
    sql_node_grcvPoLines: (t) => {
      const want = new Set();
      for (const id of idsIn(t, "gl.goods_receiving_id IN")) if (w.gr[id]) for (const l of w.gr[id].lines) if (l.po_line_item_id) want.add(String(l.po_line_item_id));
      const all = [];
      for (const d of Object.values(w.po)) for (const l of d.lines) if (want.has(String(l.id))) all.push(l);
      return all.sort(byId).map((l) => row(l, COLS.GR_PO_LINE));
    },
    sql_node_pocvHeads: (t) => idsIn(t, "p.id IN").filter((id) => w.po[id]).sort((a, b) => byId({ id: a }, { id: b })).map((id) => row(w.po[id].header, COLS.PO_HEAD)),
    sql_node_pocvLines: (t) => [].concat(...idsIn(t, "p.id IN").filter((id) => w.po[id]).sort((a, b) => byId({ id: a }, { id: b }))
      .map((id) => lines(w.po[id]).map((l) => row(l, COLS.PO_LINE, id)))),
  };
}
