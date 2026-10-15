// PO_LINE_IMPORT - Rows: each line as Batch Add leaves it after GET_ITEM_UNIT_PRICE_BULK answers (onConfirm_batchAddItem's
// update), then what the file gives on top (its quantity always; price, discount, description, remarks, date when filled)
const importRows = function importRows(resolved, priceData) {
  const lines = resolved.lines || [];
  const priced = {};
  for (const p of Array.isArray(priceData) ? priceData : priceData ? [priceData] : []) if (p && p.line_index !== undefined) priced[String(p.line_index)] = p;
  const rows = [];
  const taxOpen = [];
  lines.forEach((l, i) => {
    const row = Object.assign({}, l.line);
    const p = priced[String(i)];
    if (p) {
      Object.assign(row, { unit_price: p.unit_price, quantity_uom: p.uom_id, tax_preference: p.tax_rate, tax_percent: p.tax_percent, from_historical: p.from_historical,
        max_price: p.max_price, min_price: p.min_price, quantity: p.quantity, min_qty: p.min_qty, max_qty: p.max_qty, discount: p.discount, discount_uom: p.discount_uom });
    }
    const f = l.row;
    row.quantity = f.qty;
    if (f.price !== null && f.price !== undefined) row.unit_price = f.price;
    if (f.discount !== null && f.discount !== undefined) row.discount = f.discount;
    if (f.discountType) row.discount_uom = f.discountType;
    if (f.desc) row.item_desc = f.desc;
    if (f.remark1) row.line_remark_1 = f.remark1;
    if (f.remark2) row.line_remark_2 = f.remark2;
    if (f.date) row.po_expected_date = f.date;
    for (const k of Object.keys(row)) if (row[k] === undefined) delete row[k];
    // Batch Add keeps Tax Rate open on lines of items with a purchase tax of their own and no tax code
    if (l.headerTax === 1 && !row.tax_preference) taxOpen.push(i);
    rows.push(row);
  });
  return { route: "GO", code: "200", rowsJson: JSON.stringify(rows), taxOpenJson: JSON.stringify(taxOpen), count: String(rows.length) };
};
const res = importRows([{{node:code_node_PIresolve.data}}][0], [{{node:workflow_node_PIprice.data.data}}][0]);
console.log("import rows", JSON.stringify({ count: res.count, taxOpen: JSON.parse(res.taxOpenJson).length }));
return res;
