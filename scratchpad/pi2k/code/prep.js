// PI_SAVE v20 "Prepare": v19's Check Doc No -> Required Fields -> CHECK_REQUIRED_FIELD -> Check Invoice Qty -> Fillback chain in
// one node, so a 2,000-line invoice is copied once instead of eight times. Each step is the old node's code; its result goes
// through the same output filter the platform applied between the old nodes.
const piPrep = function piPrep(data, systemTenantId) {
  const plat = (v) => {
    if (Array.isArray(v)) return v.map(plat);
    if (v && typeof v === "object") {
      const o = {};
      for (const k of Object.keys(v)) if (v[k] !== null && v[k] !== undefined) o[k] = plat(v[k]);
      return o;
    }
    return v;
  };
  const copy = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  const ph = (v) => (v === undefined ? null : v);
  const fail = (route, message) => ({ route: route, message: message, entry: {}, isCompleted: "0", needPo: "0", needGr: "0",
    poIdsSql: "0", grIdsSql: "0", piIdSql: "0", piId: null, tenantId: "0", check: {} });

  // CHECK_REQUIRED_FIELD (1988831880511062018) v8
  const validateField = (value, field) => {
    if (value === undefined || value === null) return true;
    if (typeof value === "string") return value.trim() === "";
    if (typeof value === "number") return value <= 0;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "object") return Object.keys(value).length === 0;
    return !value;
  };
  const validateForm = (entry, requiredFields) => {
    const missingFields = [];
    requiredFields.forEach((field) => {
      const value = entry[field.name];
      if (!field.isArray) {
        if (validateField(value, field)) missingFields.push(field.label);
        return;
      }
      if (!Array.isArray(value)) {
        missingFields.push(`${field.label}`);
        return;
      }
      if (value.length === 0) {
        missingFields.push(`${field.label}`);
        return;
      }
      if (field.arrayType === "object" && field.arrayFields && value.length > 0) {
        value.forEach((item, index) => {
          field.arrayFields.forEach((subField) => {
            if (validateField(item[subField.name], subField)) missingFields.push(`${subField.label} (in ${field.label} #${index + 1})`);
          });
        });
      }
    });
    return missingFields;
  };
  const required = (fields, values) => {
    const missingFields = validateForm(JSON.parse(JSON.stringify(values)), fields);
    return missingFields.length === 0 ? "" : "Validation Error: " + missingFields.join(", ");
  };

  const bundleKey = (row) => {
    const bundle = row.item_bundle_id;
    if (bundle && typeof bundle === "object") return String(bundle.id || bundle.ib_no || "");
    return String(bundle || "");
  };
  const flattenWithParent = (rows, itemKey) => {
    const flat = [];
    const positionOf = new Map();
    const isBundleRow = (row) => Boolean(bundleKey(row)) && !row[itemKey];
    const isBundleItem = (row) => Boolean(bundleKey(row)) && Boolean(row[itemKey]);
    let openBundle = -1;
    for (const [index, row] of (rows || []).entries()) {
      const position = flat.length;
      positionOf.set(index, position);
      const children = Array.isArray(row.children) ? row.children : [];
      if (children.length > 0) {
        openBundle = -1;
        flat.push({ row, parent: -1, nested: false });
        for (const child of children) flat.push({ row: child, parent: position, nested: true });
        continue;
      }
      if (isBundleRow(row)) {
        openBundle = position;
        flat.push({ row, parent: -1, nested: false });
        continue;
      }
      if (!isBundleItem(row)) {
        openBundle = -1;
        flat.push({ row, parent: -1, nested: false });
        continue;
      }
      let parent = -1;
      for (let candidate = index - 1; candidate >= 0; candidate--) {
        const candidateRow = rows[candidate];
        if (!isBundleRow(candidateRow)) continue;
        const byId = row.parent_id != null && candidateRow.id != null && String(row.parent_id) === String(candidateRow.id);
        const byKey = row.parent_fm_key != null && candidateRow.fm_key != null && String(row.parent_fm_key) === String(candidateRow.fm_key);
        if (byId || byKey) {
          parent = positionOf.get(candidate);
          break;
        }
      }
      if (parent === -1 && openBundle !== -1 && bundleKey(flat[openBundle].row) === bundleKey(row)) parent = openBundle;
      flat.push({ row, parent, nested: false });
    }
    return flat;
  };

  // Check Invoice Qty (code_pi_checkqty)
  const checkQty = (entry) => {
    const flat = flattenWithParent(entry.table_pi, "material_id");
    const totalQuantity = flat.reduce((sum, item) => {
      const { invoice_qty } = item.row;
      const positiveQty = Math.abs(invoice_qty);
      return sum + (positiveQty || 0);
    }, 0);
    if (totalQuantity === 0) return null;
    const dropped = new Set();
    for (const [position, item] of flat.entries()) {
      if (item.row.invoice_qty !== 0) continue;
      dropped.add(position);
      if (item.parent !== -1) continue;
      for (const [childPosition, candidate] of flat.entries()) if (candidate.parent === position) dropped.add(childPosition);
    }
    // the bundle items of each kept row, in order (v19 scanned every row per row)
    const nestedUnder = new Map();
    for (const [childPosition, candidate] of flat.entries()) {
      if (dropped.has(childPosition) || !candidate.nested) continue;
      if (!nestedUnder.has(candidate.parent)) nestedUnder.set(candidate.parent, []);
      nestedUnder.get(candidate.parent).push(candidate.row);
    }
    const keptRows = [];
    for (const [position, item] of flat.entries()) {
      if (dropped.has(position) || item.nested) continue;
      const children = nestedUnder.get(position) || [];
      if (children.length > 0) keptRows.push({ ...item.row, children });
      else if (Array.isArray(item.row.children)) keptRows.push({ ...item.row, children: [] });
      else keptRows.push(item.row);
    }
    entry.table_pi = keptRows;
    let poID = [];
    let grID = [];
    let purchaseOrderNumber = [];
    let goodsReceivingNumber = [];
    for (const [position, item] of flat.entries()) {
      if (dropped.has(position)) continue;
      const pi = item.row;
      if (pi.line_gr_id && pi.line_gr_id !== "") {
        grID.push(pi.line_gr_id);
        goodsReceivingNumber.push(pi.goods_receiving_no);
      }
      poID.push(pi.line_po_id);
      purchaseOrderNumber.push(pi.purchase_order_no);
    }
    entry.po_id = [...new Set(poID)];
    entry.gr_id = [...new Set(grID)];
    entry.po_no_display = [...new Set(purchaseOrderNumber)].join(", ");
    entry.gr_no_display = [...new Set(goodsReceivingNumber)].join(", ");
    return entry;
  };

  // Fillback Header Fields (code_pi_fillback)
  const fillback = (entry) => {
    const stampPiLineItem = (piLineItem) => {
      piLineItem.supplier_id = entry.supplier_name || null;
      piLineItem.plant_id = entry.plant_id || null;
      piLineItem.payment_term_id = entry.invoice_payment_term_id || null;
      piLineItem.billing_state_id = entry.billing_address_state || null;
      piLineItem.billing_country_id = entry.billing_address_country || null;
      piLineItem.shipping_state_id = entry.shipping_address_state || null;
      piLineItem.shipping_country_id = entry.shipping_address_country || null;
      piLineItem.agent_id = entry.agent_id;
    };
    const flat = flattenWithParent(entry.table_pi, "material_id");
    const itemsNumbered = new Map();
    let lineNumber = 0;
    for (const item of flat) {
      stampPiLineItem(item.row);
      if (item.parent === -1) {
        lineNumber++;
        item.row.line_index = lineNumber;
        continue;
      }
      const childNumber = (itemsNumbered.get(item.parent) || 0) + 1;
      itemsNumbered.set(item.parent, childNumber);
      item.row.line_index = `${flat[item.parent].row.line_index}-${childNumber}`;
    }
    entry.posted_status = entry.pi_status === "Draft" ? "" : "Unposted";
    return entry;
  };

  let entry;
  if (data && data.pi_status === "Draft") {
    let table = copy(data);
    if (table.purchase_invoice_no_type !== -9999 && (!table.purchase_invoice_no || table.purchase_invoice_no === null || table.purchase_invoice_no === "")) {
      table.purchase_invoice_no = "draft";
    }
    table.pi_status = "Draft";
    table = plat(table);
    const missing = required([
      { name: "plant_id", label: "Plant" },
      { name: "purchase_invoice_no", label: "Purchase Invoice Number" },
      { name: "table_pi", label: "Item Information", isArray: true, arrayType: "object", arrayFields: [] },
    ], { plant_id: ph(table.plant_id), purchase_invoice_no: ph(table.purchase_invoice_no), table_pi: ph(table.table_pi) });
    if (missing) return fail("E406", missing);
    entry = table;
  } else {
    let table = copy(data);
    if (table.purchase_invoice_no_type !== -9999 && (!table.purchase_invoice_no || table.purchase_invoice_no === null || table.purchase_invoice_no === "" ||
      table.previous_status === "Draft")) {
      table.purchase_invoice_no = "issued";
    }
    table.pi_status = "Completed";
    table = plat(table);
    const missing = required([
      { name: "plant_id", label: "Plant" },
      { name: "purchase_invoice_no", label: "Purchase Invoice Number" },
      { name: "invoice_date", label: "Invoice Date" },
      { name: "pi_description", label: "Description" },
      { name: "table_pi", label: "PI Items", isArray: true, arrayType: "object", arrayFields: [] },
    ], { plant_id: ph(table.plant_id), purchase_invoice_no: ph(table.purchase_invoice_no), invoice_date: ph(table.invoice_date),
      pi_description: ph(table.pi_description), table_pi: ph(table.table_pi) });
    if (missing) return fail("E406", missing);
    entry = checkQty(table);
    if (!entry) return fail("E407", "Total invoiced quantity is 0.");
    entry = plat(entry);
  }
  entry = plat(fillback(entry));

  // What the over-invoice check and the PO / GR roll-up read off the lines, keeping the tree as it is
  const LINE_KEYS = ["id", "line_po_id", "line_gr_id", "po_line_id", "gr_line_id", "invoice_qty", "material_id", "material_name", "item_bundle_id",
    "parent_id", "fm_key", "parent_fm_key"];
  const compact = (row) => {
    const out = {};
    if (!row || typeof row !== "object") return out;
    for (const k of LINE_KEYS) if (Object.prototype.hasOwnProperty.call(row, k)) out[k] = row[k];
    if (Array.isArray(row.children)) out.children = row.children.map(compact);
    return out;
  };
  const idsSql = (v) => {
    const ids = (Array.isArray(v) ? v : [v]).map((x) => (x === undefined || x === null ? "" : String(x).trim())).filter((x) => /^[0-9]{1,20}$/.test(x));
    return ids.length ? [...new Set(ids)].join(",") : "0";
  };
  const isCompleted = entry.pi_status === "Completed";
  const tenantId = systemTenantId === undefined || systemTenantId === null ? "" : String(systemTenantId);
  const poIdsSql = idsSql(entry.po_id);
  const grIdsSql = entry.gr_id && entry.gr_id.length > 0 ? idsSql(entry.gr_id) : "0";
  const rawId = entry.id === undefined || entry.id === null ? "" : String(entry.id).trim();
  return {
    route: "OK",
    message: "",
    entry: entry,
    isCompleted: isCompleted ? "1" : "0",
    needPo: isCompleted && poIdsSql !== "0" ? "1" : "0",
    needGr: isCompleted && grIdsSql !== "0" ? "1" : "0",
    poIdsSql: poIdsSql,
    grIdsSql: grIdsSql,
    piIdSql: /^[0-9]{1,20}$/.test(rawId) ? rawId : "0",
    piId: entry.id === undefined ? null : entry.id,
    tenantId: /^[0-9]{1,20}$/.test(tenantId) ? tenantId : "0",
    check: isCompleted ? { po_id: entry.po_id, gr_id: entry.gr_id, table_pi: (entry.table_pi || []).map(compact) } : {},
  };
};
