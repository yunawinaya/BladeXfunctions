// SI_SAVE v84 "Check and roll up": v83's over-invoice check (code_node_hHnkhdFI, 410) and SO / GD roll-up (code_node_4CvJopJk) in
// one node, run before the invoice is written. The orders and deliveries come from sql-nodes that read only the columns these two
// use; they are put back into the shape the old search nodes gave (null and "" keys left off, bigint ids as numbers below 16 digits,
// a bundle's items under `children`, id order). v83 wrote every order / delivery line back through table_so / table_gd; here only
// the lines whose invoiced quantity or status the roll-up changes are written, through the line collections.
const siParseJ = function siParseJ(t) {
  if (t && typeof t === "object") return t;
  try {
    return JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));
  } catch (e) {
    return null;
  }
};
const siShape = function siShape(rows, lineKey) {
  const BIG = new Set(["doc", "id", "parent_id", "item_bundle_id", "material_id"]);
  const docs = [];
  const byDoc = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const o = siParseJ(r && r.j !== undefined ? r.j : r);
    if (!o || o.doc === undefined || o.doc === null) continue;
    const docKey = String(o.doc);
    if (!byDoc.has(docKey)) {
      const doc = { id: /^-?\d{1,15}$/.test(docKey) ? Number(docKey) : docKey, lines: [] };
      byDoc.set(docKey, doc);
      docs.push(doc);
    }
    if (o.id === undefined || o.id === null || o.id === "") continue;
    const line = {};
    for (const k of Object.keys(o)) {
      if (k === "doc") continue;
      let v = o[k];
      if (v === null || v === undefined || v === "") continue;
      if (BIG.has(k) && typeof v === "string" && /^-?\d{1,15}$/.test(v)) v = Number(v);
      line[k] = v;
    }
    byDoc.get(docKey).lines.push(line);
  }
  return docs.map((doc) => {
    const ids = new Set(doc.lines.map((l) => String(l.id)));
    const kids = new Map();
    for (const l of doc.lines) {
      if (l.parent_id === undefined || !ids.has(String(l.parent_id))) continue;
      if (!kids.has(String(l.parent_id))) kids.set(String(l.parent_id), []);
      kids.get(String(l.parent_id)).push(l);
    }
    const top = doc.lines.filter((l) => l.parent_id === undefined || !ids.has(String(l.parent_id)));
    const tree = top.map((l) => (kids.has(String(l.id)) ? Object.assign({}, l, { children: kids.get(String(l.id)) }) : l));
    return { id: doc.id, [lineKey]: tree };
  });
};
const siCheck = function siCheck(data, soRows, gdRows, srSetupRaw) {
  const soList = siShape(soRows, "table_so");
  const gdList = siShape(gdRows, "table_gd");
  const srSetup = Array.isArray(srSetupRaw) ? srSetupRaw[0] : srSetupRaw;
  const deductReturnQty = Boolean(srSetup && srSetup.return_billing_method === "Deduct from Invoice");

  const absRound8 = (value) => {
    let positiveValue = Math.abs(value);
    return Math.round((parseFloat(positiveValue) || 0) * 100000000) / 100000000;
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
  const flattenRows = (rows, itemKey) => flattenWithParent(rows, itemKey).map((item) => item.row);

  // ---- code_node_hHnkhdFI (v83): the over-invoice check ----
  let allErrors = [];
  const validateInvoiceQuantities = (items, tableSi, docId, docIdKey, siLineIdKey, qtyKey, itemKey) => {
    const flatItems = flattenRows(items, itemKey);
    const filteredSI = flattenRows(tableSi, "material_id").filter((item) => item[docIdKey] === docId);
    const errors = [];
    // the first line of each id (v83 searched the whole document per invoice line)
    const byId = new Map();
    for (const item of flatItems) if (!byId.has(item.id)) byId.set(item.id, item);
    filteredSI.forEach((siItem) => {
      const originalItem = byId.get(siItem[siLineIdKey]);
      if (originalItem) {
        const returnedQty = deductReturnQty ? absRound8(originalItem.return_qty) : 0;
        const availableQty = Math.max(0, absRound8(originalItem[qtyKey]) - returnedQty);
        const currentInvoicedQty = absRound8(originalItem.invoice_qty);
        const newInvoiceQty = absRound8(siItem.invoice_qty);
        const totalInvoicedQty = absRound8(currentInvoicedQty + newInvoiceQty);
        if (totalInvoicedQty > availableQty) {
          errors.push({
            itemName: originalItem.item_id || originalItem.material_name || `Item ${originalItem.id}`,
            available: availableQty,
            total: absRound8(originalItem[qtyKey]),
            basis: qtyKey === "gd_qty" ? "delivered" : "ordered",
          });
        }
      }
    });
    return errors;
  };
  const processItemsCheck = (items, tableSi, docId, docIdKey, siLineIdKey, qtyKey, itemKey) => {
    const filteredSI = flattenRows(tableSi, "material_id").filter((item) => item[docIdKey] === docId);
    const flat = flattenWithParent(items, itemKey);
    // the order lines an invoice line points at, in order, and where each sits (v83 searched per line)
    const siLineIds = new Set(filteredSI.map((pi) => pi[siLineIdKey]));
    const filteredItems = flat.filter((entry) => siLineIds.has(entry.row.id));
    let totalItems = flat.filter((entry) => entry.parent === -1).length;
    let partiallyInvoicedItems = 0;
    let fullyInvoicedItems = 0;
    const updated = flat.map((entry) => ({ ...entry, row: { ...entry.row } }));
    const firstIndex = new Map();
    updated.forEach((entry, i) => {
      if (!firstIndex.has(entry.row.id)) firstIndex.set(entry.row.id, i);
    });
    filteredItems.forEach((filteredItem, filteredIndex) => {
      const originalIndex = firstIndex.has(filteredItem.row.id) ? firstIndex.get(filteredItem.row.id) : -1;
      if (originalIndex === -1) return;
      const piInvoicedQty = absRound8(filteredSI[filteredIndex] ? filteredSI[filteredIndex].invoice_qty : undefined);
      const currentInvoicedQty = absRound8(updated[originalIndex].row.invoice_qty);
      const totalInvoicedQty = absRound8(currentInvoicedQty + piInvoicedQty);
      updated[originalIndex].row.invoice_qty = totalInvoicedQty;
    });
    for (const entry of updated) {
      if (entry.parent !== -1) continue;
      const billable = Math.max(0, absRound8(entry.row[qtyKey]) - (deductReturnQty ? absRound8(entry.row.return_qty) : 0));
      if (absRound8(entry.row.invoice_qty) > 0) {
        partiallyInvoicedItems++;
        entry.row.si_status = "Partially Invoiced";
        if (absRound8(entry.row.invoice_qty) >= billable) {
          fullyInvoicedItems++;
          entry.row.si_status = "Fully Invoiced";
        }
      } else if (deductReturnQty && billable <= 0) {
        fullyInvoicedItems++;
      }
    }
    const allItemsComplete = fullyInvoicedItems === totalItems;
    const anyItemProcessing = partiallyInvoicedItems > 0;
    return anyItemProcessing ? (allItemsComplete ? "Fully Invoiced" : "Partially Invoiced") : "";
  };
  const soIds = Array.isArray(data.so_id) ? data.so_id : [data.so_id];
  let updatedGD = [];
  if (data.gd_id.length > 0) {
    const gdIds = Array.isArray(data.gd_id) ? data.gd_id : [data.gd_id];
    for (const gdID of gdIds) {
      const gdData = gdList.find((gd) => gd.id === gdID);
      const gdItems = gdData.table_gd || [];
      allErrors = [...allErrors, ...validateInvoiceQuantities(gdItems, data.table_si, gdData.id, "line_gd_id", "gd_line_id", "gd_qty", "material_id")];
      updatedGD.push({ gd_id: gdData.id, si_status: processItemsCheck(gdItems, data.table_si, gdData.id, "line_gd_id", "gd_line_id", "gd_qty", "material_id") });
    }
  }
  let updatedSO = [];
  for (const soID of soIds) {
    const soData = soList.find((so) => so.id === soID);
    const soItems = soData.table_so || [];
    allErrors = [...allErrors, ...validateInvoiceQuantities(soItems, data.table_si, soData.id, "line_so_id", "so_line_id", "so_quantity", "item_name")];
    updatedSO.push({ so_id: soData.id, si_status: processItemsCheck(soItems, data.table_si, soData.id, "line_so_id", "so_line_id", "so_quantity", "item_name") });
  }
  updatedGD = updatedGD.filter((gd) => gd.si_status === "Fully Invoiced").map((gd) => gd.gd_id);
  updatedSO = updatedSO.filter((so) => so.si_status === "Fully Invoiced").map((so) => so.so_id);
  if (allErrors.length > 0) {
    return { status: "Failed", allErrors, updatedGD, updatedSO, soHeaders: [], hasSoHeaders: 0, soLines: [], hasSoLines: 0, gdHeaders: [],
      hasGdHeaders: 0, gdLines: [], hasGdLines: 0 };
  }

  // ---- code_node_4CvJopJk (v83): the SO / GD roll-up ----
  const qtyStr = (value) => absRound8(value).toFixed(8);
  const processItems = (items, tableSi, docId, docIdKey, siLineIdKey, qtyKey, itemKey) => {
    const filteredSI = flattenRows(tableSi, "material_id").filter((item) => item[docIdKey] === docId);
    const flat = flattenWithParent(items, itemKey);
    let totalItems = flat.filter((entry) => entry.parent === -1).length;
    let partiallyInvoicedItems = 0;
    let fullyInvoicedItems = 0;
    // the first invoice line pointing at each order line (v83 searched the invoice per order line)
    const firstSI = new Map();
    for (const pi of filteredSI) if (!firstSI.has(pi[siLineIdKey])) firstSI.set(pi[siLineIdKey], pi);
    const updated = flat.map(({ row, parent, nested }) => {
      const matchedSI = firstSI.get(row.id);
      if (matchedSI) {
        const piInvoicedQty = absRound8(matchedSI.invoice_qty);
        const currentInvoicedQty = absRound8(row.invoice_qty);
        const totalInvoicedQty = absRound8(currentInvoicedQty + piInvoicedQty);
        const updatedItem = { ...row, invoice_qty: totalInvoicedQty };
        if (absRound8(updatedItem.invoice_qty) > 0) {
          if (parent === -1) partiallyInvoicedItems++;
          updatedItem.si_status = "Partially Invoiced";
          if (absRound8(updatedItem.invoice_qty) >= absRound8(row[qtyKey] || 0)) {
            if (parent === -1) fullyInvoicedItems++;
            updatedItem.si_status = "Fully Invoiced";
          }
        }
        return { row: updatedItem, parent, nested };
      }
      return { row: { ...row }, parent, nested };
    });
    for (const entry of updated) {
      if (entry.parent === -1) continue;
      entry.row.si_status = updated[entry.parent].row.si_status;
    }
    // v83 wrote every line back; only the ones whose invoiced quantity or status moved are written here. A bundle item whose
    // bundle line has no status went back without the key, which the platform stores as NULL: it is written as "" here.
    const lineUpdates = [];
    for (const [index, entry] of updated.entries()) {
      const before = flat[index].row;
      const status = entry.row.si_status === undefined || entry.row.si_status === null ? "" : String(entry.row.si_status);
      const was = before.si_status === undefined || before.si_status === null ? "" : String(before.si_status);
      if (absRound8(entry.row.invoice_qty) === absRound8(before.invoice_qty) && status === was) continue;
      lineUpdates.push({ id: entry.row.id, invoice_qty: qtyStr(entry.row.invoice_qty), si_status: status });
    }
    // The header counts every line as it stands after this invoice, the way SI_CANCEL counts it (user, 2026-10-21). v83 counted only
    // the lines this invoice touched (partiallyInvoicedItems / fullyInvoicedItems above), so an order invoiced across several invoices
    // stayed "Partially Invoiced" with every line fully invoiced - 75 sales orders on prod.
    const top = updated.filter((entry) => entry.parent === -1);
    const fully = top.filter((entry) => entry.row.si_status === "Fully Invoiced").length;
    const partly = top.filter((entry) => entry.row.si_status === "Partially Invoiced").length;
    const newSIStatus = partly > 0 || fully > 0 ? (fully === totalItems ? "Fully Invoiced" : "Partially Invoiced") : "";
    return { lineUpdates, newSIStatus };
  };
  const gdHeaders = [];
  const gdLines = [];
  if (data.gd_id.length > 0) {
    const gdIds = Array.isArray(data.gd_id) ? data.gd_id : [data.gd_id];
    for (const gdID of gdIds) {
      const gdData = gdList.find((gd) => gd.id === gdID);
      const { lineUpdates, newSIStatus } = processItems(gdData.table_gd || [], data.table_si, gdData.id, "line_gd_id", "gd_line_id", "gd_qty", "material_id");
      gdHeaders.push({ id: gdData.id, si_status: newSIStatus });
      gdLines.push(...lineUpdates);
    }
  }
  const soHeaders = [];
  const soLines = [];
  for (const soID of soIds) {
    const soData = soList.find((so) => so.id === soID);
    const { lineUpdates, newSIStatus } = processItems(soData.table_so || [], data.table_si, soData.id, "line_so_id", "so_line_id", "so_quantity", "item_name");
    soHeaders.push({ id: soData.id, si_status: newSIStatus });
    soLines.push(...lineUpdates);
  }
  const flag = (rows) => (rows.length > 0 ? 1 : 0);
  return {
    status: "Success",
    allErrors: [],
    updatedGD,
    updatedSO,
    soHeaders,
    hasSoHeaders: flag(soHeaders),
    soLines,
    hasSoLines: flag(soLines),
    gdHeaders,
    hasGdHeaders: flag(gdHeaders),
    gdLines,
    hasGdLines: flag(gdLines),
  };
};
