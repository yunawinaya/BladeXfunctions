// SI_SAVE v84 "Prepare": v83's Check Doc No -> Required Fields -> CHECK_REQUIRED_FIELD -> Check Invoice Qty -> Fillback chain in
// one node (and the Draft branch's Draft Check Doc No -> Draft Required Fields -> CHECK_REQUIRED_FIELD -> Fillback), so a 2,000-line
// invoice is copied once instead of ten times. Each step is the old node's code; its result goes through the same output filter the
// platform applied between the old nodes. The credit-limit downgrade to Draft (v83's Change Status to Draft, between Check Invoice Qty
// and Fillback) only touches si_status / posted_status / the number sentinel / payment_status: "Final Status" applies it afterwards.
const siPrep = function siPrep(data, systemTenantId) {
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
  const fail = (route, message) => ({ route: route, message: message, entry: {}, isDraft: "0", needCl: "", tenantId: "0",
    soIdsSql: "0", gdIdsSql: "0", siIdSql: "0", check: {} });

  // Collect PI Source Ids (code_si_srcids), read off the request as it arrived
  const srcIds = (raw) => {
    const tableSi = raw && raw.table_si ? raw.table_si : [];
    const soSet = {};
    const gdSet = {};
    for (const r of tableSi) {
      if (!r) continue;
      if ((r.invoice_qty || 0) <= 0) continue;
      if (r.line_so_id) soSet[String(r.line_so_id)] = true;
      if (r.line_gd_id) gdSet[String(r.line_gd_id)] = true;
    }
    const soIds = Object.keys(soSet);
    const gdReal = Object.keys(gdSet);
    return { soIds: soIds.length ? soIds : ["0"], gdIdsSearch: gdReal.length ? gdReal : ["0"], gdIdsReal: gdReal };
  };

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

  // Check Invoice Qty (code_node_QaPUxa3s)
  const checkQty = (entry) => {
    const flat = flattenWithParent(entry.table_si, "material_id");
    const totalQuantity = flat.reduce((sum, item) => {
      const { invoice_qty } = item.row;
      const positiveInvQty = Math.abs(invoice_qty);
      return sum + (positiveInvQty || 0);
    }, 0);
    if (totalQuantity === 0) return null;
    const dropped = new Set();
    for (const [position, item] of flat.entries()) {
      if (item.row.invoice_qty !== 0) continue;
      dropped.add(position);
      if (item.parent !== -1) continue;
      for (const [childPosition, candidate] of flat.entries()) if (candidate.parent === position) dropped.add(childPosition);
    }
    // the kept bundle items of each row, in order (v83 scanned every row per row)
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
    entry.table_si = keptRows;
    let soID = [];
    let gdID = [];
    let salesOrderNumber = [];
    let goodsDeliveryNumber = [];
    for (const [position, item] of flat.entries()) {
      if (dropped.has(position)) continue;
      const si = item.row;
      if (si.line_gd_id && si.line_gd_id !== "") {
        gdID.push(si.line_gd_id);
        goodsDeliveryNumber.push(si.line_gd_no);
      }
      soID.push(si.line_so_id);
      salesOrderNumber.push(si.line_so_no);
    }
    entry.so_id = [...new Set(soID)];
    entry.gd_id = [...new Set(gdID)];
    entry.so_no_display = [...new Set(salesOrderNumber)].join(", ");
    entry.gd_no_display = [...new Set(goodsDeliveryNumber)].join(", ");
    return entry;
  };

  // Fillback Header Fields (code_node_JoF0YVzG)
  const fillback = (entry) => {
    const round8 = (value) => Math.round((parseFloat(value) || 0) * 100000000) / 100000000;
    const stampSiLineItem = (siLineItem) => {
      siLineItem.customer_id = entry.customer_id || null;
      siLineItem.plant_id = entry.plant_id || null;
      siLineItem.payment_term_id = entry.si_payment_term_id || null;
      siLineItem.billing_state_id = entry.billing_address_state || null;
      siLineItem.billing_country_id = entry.billing_address_country || null;
      siLineItem.shipping_state_id = entry.shipping_address_state || null;
      siLineItem.shipping_country_id = entry.shipping_address_country || null;
      siLineItem.agent_id = entry.sales_person_id;
      siLineItem.tax_amount = round8(parseFloat(siLineItem.tax_amount || 0));
      siLineItem.so_order_quantity = round8(parseFloat(siLineItem.so_order_quantity || 0));
      siLineItem.si_discount = round8(parseFloat(siLineItem.si_discount || 0));
      siLineItem.discount_amount = round8(parseFloat(siLineItem.discount_amount || 0));
      siLineItem.invoice_qty = round8(parseFloat(siLineItem.invoice_qty || 0));
      siLineItem.si_amount = round8(parseFloat(siLineItem.si_amount || 0));
      siLineItem.gross = round8(parseFloat(siLineItem.gross || 0));
      siLineItem.area_id = entry.si_area_id || "";
      siLineItem.agent_user_id = entry.agent_user_id || "";
    };
    const flat = flattenWithParent(entry.table_si, "material_id");
    const itemsNumbered = new Map();
    let lineNumber = 0;
    for (const item of flat) {
      stampSiLineItem(item.row);
      if (item.parent === -1) {
        lineNumber++;
        item.row.line_index = lineNumber;
        continue;
      }
      const childNumber = (itemsNumbered.get(item.parent) || 0) + 1;
      itemsNumbered.set(item.parent, childNumber);
      item.row.line_index = `${flat[item.parent].row.line_index}-${childNumber}`;
    }
    entry.invoice_subtotal = round8(parseFloat(entry.invoice_subtotal || 0));
    entry.invoice_total_discount = round8(parseFloat(entry.invoice_total_discount || 0));
    entry.invoice_taxes_amount = round8(parseFloat(entry.invoice_taxes_amount || 0));
    entry.invoice_total = round8(parseFloat(entry.invoice_total || 0));
    entry.myr_total_amount = round8(parseFloat(entry.myr_total_amount || 0));
    entry.outstanding_amount = round8(parseFloat(entry.invoice_total || 0));
    entry.payment_status = entry.si_status === "Draft" ? "" : "Unpaid";
    return entry;
  };

  const src = srcIds(data);
  const isDraft = data && data.si_status === "Draft";
  let entry;
  let needCl = "";
  let clCustomerId = null;
  let clTotal = null;
  if (isDraft) {
    // Draft Check Doc No (code_node_2Pxz18TD) -> Draft Required Fields (code_node_pFAvrqMt) -> CHECK_REQUIRED_FIELD
    let table = copy(data);
    if (table.sales_invoice_no_type !== -9999 && (!table.sales_invoice_no || table.sales_invoice_no === null || table.sales_invoice_no === "")) {
      table.sales_invoice_no = "draft";
    }
    table = plat(table);
    const missing = required([
      { name: "plant_id", label: "Plant" },
      { name: "sales_invoice_no", label: "Sales Invoice Number " },
      { name: "table_si", label: "Item Information", isArray: true, arrayType: "object", arrayFields: [] },
    ], { plant_id: ph(table.plant_id), sales_invoice_no: ph(table.sales_invoice_no), table_si: ph(table.table_si) });
    if (missing) return fail("E406", missing);
    entry = table;
  } else {
    // Check Doc No (code_node_QdIIcL7J) -> Required Fields (code_node_zy0OA1sN) -> CHECK_REQUIRED_FIELD -> Check Invoice Qty
    let table = copy(data);
    if (table.sales_invoice_no_type !== -9999 && (!table.sales_invoice_no || table.sales_invoice_no === null || table.sales_invoice_no === "" ||
      table.previous_status !== "Issued")) {
      table.sales_invoice_no = "issued";
    }
    if (!table.need_cl || table.need_cl === "" || table.need_cl === null) {
      if (table.acc_integration_type !== "No Accounting") table.need_cl = "required";
      else table.need_cl = "not required";
    }
    table = plat(table);
    const missing = required([
      { name: "plant_id", label: "Plant" },
      { name: "sales_invoice_no", label: "Sales Invoice Number " },
      { name: "sales_invoice_date", label: "Sales Invoice Date" },
      { name: "si_description", label: "Description" },
      { name: "table_si", label: "SI Items", isArray: true, arrayType: "object", arrayFields: [] },
    ], { plant_id: ph(table.plant_id), sales_invoice_no: ph(table.sales_invoice_no), sales_invoice_date: ph(table.sales_invoice_date),
      si_description: ph(table.si_description), table_si: ph(table.table_si) });
    if (missing) return fail("E406", missing);
    entry = checkQty(table);
    if (!entry) return fail("E407", "Total invoiced quantity is 0.");
    entry = plat(entry);
    // what Need CL? / Run CL Workflow read off Check Invoice Qty's entry, before the fill-back rounds the totals
    needCl = entry.need_cl === undefined || entry.need_cl === null ? "" : String(entry.need_cl);
    clCustomerId = entry.customer_id === undefined ? null : entry.customer_id;
    clTotal = entry.invoice_total === undefined ? null : entry.invoice_total;
  }
  entry = plat(fillback(entry));

  // What the over-invoice check and the SO / GD roll-up read off the invoice lines, keeping the tree as it is
  const LINE_KEYS = ["id", "line_so_id", "line_gd_id", "so_line_id", "gd_line_id", "invoice_qty", "material_id", "item_bundle_id",
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
  const tenantId = systemTenantId === undefined || systemTenantId === null ? "" : String(systemTenantId);
  const rawId = entry.id === undefined || entry.id === null ? "" : String(entry.id).trim();
  return {
    route: "OK",
    message: "",
    entry: entry,
    isDraft: isDraft ? "1" : "0",
    needCl: needCl,
    clCustomerId: clCustomerId,
    clTotal: clTotal,
    siStatus: entry.si_status,
    postedStatus: entry.posted_status,
    docNo: entry.sales_invoice_no,
    paymentStatus: entry.payment_status,
    soIds: src.soIds,
    gdIdsSearch: src.gdIdsSearch,
    gdIdsReal: src.gdIdsReal,
    tenantId: /^[0-9]{1,20}$/.test(tenantId) ? tenantId : "0",
    soIdsSql: idsSql(entry.so_id),
    gdIdsSql: entry.gd_id && entry.gd_id.length > 0 ? idsSql(entry.gd_id) : "0",
    siIdSql: /^[0-9]{1,20}$/.test(rawId) ? rawId : "0",
    siId: entry.id === undefined ? null : entry.id,
    check: isDraft ? {} : { so_id: entry.so_id, gd_id: entry.gd_id, table_si: (entry.table_si || []).map(compact) },
  };
};
