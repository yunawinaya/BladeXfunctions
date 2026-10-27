// PO_LINE_IMPORT - Resolve: each row's item (its code, as the database compares codes) and UOM (one of the item's own,
// by name; blank = the default purchase UOM, as Batch Add takes it), every problem listed; the lines as Batch Add starts
// them (onConfirm_batchAddItem) and what GET_ITEM_UNIT_PRICE_BULK is asked for them
const parseJ = (t) => {
  try {
    return JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));
  } catch (e) {
    return null;
  }
};
const importResolve = function importResolve(guard, itemRows) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const base = { route: "STOP", code: "400", message: "", errors: [], errorsShown: [], lines: [], itemData: [], altUomJson: "{}", count: 0 };
  const key = (c) => s(c).toLowerCase();
  // what the file should say instead: the item's base UOM, then its other units
  const uomHint = (item, conv) => {
    const baseRow = conv.find((c) => s(c.alt_uom_id) === s(item.based_uom));
    const baseName = s(item.based_uom_name) || s(baseRow && baseRow.uom_name);
    const others = [...new Set(conv.map((c) => s(c.uom_name)).filter((n) => n && key(n) !== key(baseName)))];
    if (baseName) return ". Use its base UOM " + baseName + (others.length ? " (or " + others.join(", ") + ")" : "");
    return others.length ? ". Its units: " + others.join(", ") : "";
  };
  const byCode = {};
  for (const r of Array.isArray(itemRows) ? itemRows : itemRows ? [itemRows] : []) {
    const o = r && (typeof r.j === "string" ? parseJ(r.j) : r.j || r);
    if (!o || !s(o.id)) continue;
    (byCode[key(o.material_code)] = byCode[key(o.material_code)] || []).push(o);
  }
  const errors = [];
  const lines = [];
  // alt_uom once per item (the form puts it on each of the item's lines): the answer stays small when items repeat
  const altUom = {};
  for (const row of guard.rows || []) {
    const err = (msg) => errors.push({ row: row.n, message: msg });
    let found = byCode[key(row.code)] || [];
    if (found.length > 1) found = found.filter((o) => s(o.material_code) === row.code).length === 1 ? found.filter((o) => s(o.material_code) === row.code) : found;
    if (found.length === 0) {
      err("Item Code " + row.code + " was not found");
      continue;
    }
    if (found.length > 1) {
      err("Item Code " + row.code + " matches " + found.length + " items");
      continue;
    }
    const item = found[0];
    if (String(item.is_active) === "0") {
      err("Item " + row.code + " is inactive");
      continue;
    }
    const conv = Array.isArray(item.conv) ? item.conv : [];
    let uom = null;
    if (row.uom) {
      const named = conv.filter((c) => key(c.uom_name) === key(row.uom));
      if (named.length !== 1) {
        err(named.length ? "UOM " + row.uom + " matches " + named.length + " units of item " + row.code : "UOM " + row.uom + " is not a unit of item " + row.code + uomHint(item, conv));
        continue;
      }
      uom = named[0];
    } else {
      uom = conv.find((c) => String(c.purchase_default_uom) === "1") || conv.find((c) => s(c.alt_uom_id) === s(item.based_uom)) || null;
      if (!uom) {
        err("Item " + row.code + " has no purchase UOM: give the UOM");
        continue;
      }
    }
    const binds = Array.isArray(item.binds) ? item.binds : [];
    const bound = binds.find((b) => s(b.supplier_id) === s(guard.supplierId) && s(b.item_description));
    if (altUom[s(item.id)] === undefined) altUom[s(item.id)] = JSON.stringify(conv.map((c) => {
      const o = Object.assign({}, c);
      delete o.uom_name;
      return o;
    }));
    // onConfirm_batchAddItem's poItem, from the chosen UOM's row (blank UOM: the default purchase row it reads)
    lines.push({
      row: row,
      line: {
        item_id: s(item.id),
        item_name: item.material_name === undefined ? null : item.material_name,
        item_desc: s(bound && bound.item_description) || item.material_desc || "",
        unit_price: uom.purchase_unit_price || 0,
        item_category_id: item.item_category === undefined ? null : item.item_category,
        tax_preference: s(uom.mat_purchase_tax_id) || null,
        tax_percent: uom.purchase_tax_percent || null,
        quantity_uom: s(uom.alt_uom_id) || null,
        further_description: item.further_description === undefined ? null : item.further_description,
        min_quantity: uom.min_purchase_qty || 0,
        max_quantity: uom.max_purchase_qty || 0,
      },
      headerTax: s(item.mat_purchase_tax_id) ? 1 : 0,
    });
  }
  if (errors.length) return Object.assign(base, { message: errors.length + " line(s) cannot be imported - nothing was added.", errors: errors, errorsShown: errors.slice(0, 30) });
  // what Batch Add asks GET_ITEM_UNIT_PRICE_BULK, plus the quantity the file gives (price tags apply by quantity)
  const itemData = lines.map((l, i) => ({ item_id: l.line.item_id, unit_price: l.line.unit_price, line_index: i, uom_id: l.line.quantity_uom, tax_rate: l.line.tax_preference || null,
    tax_percent: l.line.tax_percent || null, quantity: l.row.qty }));
  return Object.assign(base, { route: "GO", code: "200", lines: lines, itemData: itemData, altUomJson: JSON.stringify(altUom), count: lines.length });
};
const res = importResolve([{{node:code_node_PIguard.data}}][0], [{{node:sql_node_PIitems.data}}][0]);
res.errorsJson = JSON.stringify(res.errorsShown);
res.errorCount = String(res.errors.length);
console.log("import resolve", JSON.stringify({ route: res.route, lines: res.count, errors: res.errors.length }));
return res;
