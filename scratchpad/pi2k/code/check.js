// PI_SAVE v20 "Check and roll up": v19's over-invoice check (code_pi_validate) and PO / GR roll-up (code_pi_apply) in one node,
// run before the invoice is written. The orders and receipts come from sql-nodes that read only the columns these two use; they
// are put back into the shape the old search nodes gave (null and "" keys left off, a bundle's items under `children`).
const piParseJ = function piParseJ(t) {
  if (t && typeof t === "object") return t;
  try {
    return JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));
  } catch (e) {
    return null;
  }
};
const piShape = function piShape(rows, lineKey) {
  const docs = [];
  const byDoc = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const o = piParseJ(r && r.j !== undefined ? r.j : r);
    if (!o || !o.doc) continue;
    if (!byDoc.has(o.doc)) {
      const doc = { id: o.doc, lines: [] };
      byDoc.set(o.doc, doc);
      docs.push(doc);
    }
    if (o.id === undefined || o.id === null || o.id === "") continue;
    const line = {};
    for (const k of Object.keys(o)) if (k !== "doc" && o[k] !== null && o[k] !== undefined && o[k] !== "") line[k] = o[k];
    byDoc.get(o.doc).lines.push(line);
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
const piCheck = function piCheck(data, poRows, grRows) {
  const poList = piShape(poRows, "table_po");
  const grList = piShape(grRows, "table_gr");

  // ---- code_pi_validate (v19) ----
  let allErrors = [];
  const flattenRows = (rows) => {
    const flat = [];
    for (const row of rows || []) {
      flat.push(row);
      const children = Array.isArray(row.children) ? row.children : [];
      for (const child of children) flat.push(child);
    }
    return flat;
  };
  const round8 = (value) => Math.round((parseFloat(value) || 0) * 100000000) / 100000000;
  const validateInvoiceQuantities = (items, tablePi, docId, docIdKey, piLineIdKey, qtyKey, excludeGRLines) => {
    const filteredPI = tablePi.filter((item) => item[docIdKey] === docId && (!excludeGRLines || !item.line_gr_id || item.line_gr_id === ""));
    const errors = [];
    const byId = new Map();
    for (const item of items) if (!byId.has(item.id)) byId.set(item.id, item);
    filteredPI.forEach((piItem) => {
      const originalItem = byId.get(piItem[piLineIdKey]);
      if (originalItem) {
        const availableQty = round8(originalItem[qtyKey]);
        const currentInvoicedQty = round8(originalItem.invoice_qty);
        const newInvoiceQty = round8(piItem.invoice_qty);
        const totalInvoicedQty = round8(currentInvoicedQty + newInvoiceQty);
        if (totalInvoicedQty > availableQty) {
          errors.push({ itemName: originalItem.material_id || originalItem.material_name || `Item ${originalItem.id}` });
        }
      }
    });
    if (!excludeGRLines) {
      filteredPI.forEach((piItem) => {
        if ((piItem.gr_line_id && piItem.gr_line_id !== "") || !piItem.po_line_id) return;
        const groupRows = items.filter((item) => item.parent_or_child === "Split-Parent" && item.po_line_item_id === piItem.po_line_id);
        if (groupRows.length === 0) return;
        const totalRemaining = round8(groupRows.reduce((sum, item) => sum + ((parseFloat(item.received_qty) || 0) - (parseFloat(item.invoice_qty) || 0)), 0));
        if (round8(piItem.invoice_qty) > totalRemaining) {
          errors.push({ itemName: piItem.material_id || piItem.material_name || `Item ${piItem.po_line_id}` });
        }
      });
    }
    return errors;
  };
  const poIds = Array.isArray(data.po_id) ? data.po_id : [data.po_id];
  for (const poID of poIds) {
    const poData = poList.find((po) => po.id === poID);
    if (!poData) continue;
    const poItems = flattenRows(poData.table_po || []);
    allErrors = [...allErrors, ...validateInvoiceQuantities(poItems, flattenRows(data.table_pi), poData.id, "line_po_id", "po_line_id", "quantity", true)];
  }
  if (data.gr_id && data.gr_id.length > 0) {
    const grIds = Array.isArray(data.gr_id) ? data.gr_id : [data.gr_id];
    for (const grID of grIds) {
      const grData = grList.find((gr) => gr.id === grID);
      if (!grData) continue;
      const grItems = flattenRows(grData.table_gr || []);
      allErrors = [...allErrors, ...validateInvoiceQuantities(grItems, flattenRows(data.table_pi), grData.id, "line_gr_id", "gr_line_id", "received_qty")];
    }
  }
  if (allErrors.length > 0) return { status: "Failed", allErrors: allErrors };

  // ---- code_pi_apply (v19) ----
  const absRound8 = (value) => {
    let positiveValue = Math.abs(value);
    return Math.round((parseFloat(positiveValue) || 0) * 100000000) / 100000000;
  };
  const qtyStr = (value) => absRound8(value).toFixed(8);
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
  const flattenRowsP = (rows, itemKey) => flattenWithParent(rows, itemKey).map((item) => item.row);
  const processItems = (items, tablePi, docId, docIdKey, piLineIdKey, qtyKey) => {
    const filteredPI = flattenRowsP(tablePi, "material_id").filter((item) => item[docIdKey] === docId);
    const isGR = piLineIdKey === "gr_line_id";
    const distributedByRowId = {};
    if (isGR) {
      const combinedPIs = filteredPI.filter((pi) => (!pi.gr_line_id || pi.gr_line_id === "") && pi.po_line_id);
      for (const cpi of combinedPIs) {
        const groupRows = items.filter((r) => r.parent_or_child === "Split-Parent" && r.po_line_item_id === cpi.po_line_id)
          .sort((a, b) => String(a.line_index).localeCompare(String(b.line_index), undefined, { numeric: true }));
        let remainingToAllocate = absRound8(cpi.invoice_qty);
        for (const r of groupRows) {
          if (remainingToAllocate <= 0) break;
          const already = distributedByRowId[r.id] || 0;
          const capacity = absRound8((parseFloat(r.received_qty) || 0) - (parseFloat(r.invoice_qty) || 0) - already);
          if (capacity <= 0) continue;
          const alloc = Math.min(remainingToAllocate, capacity);
          distributedByRowId[r.id] = absRound8(already + alloc);
          remainingToAllocate = absRound8(remainingToAllocate - alloc);
        }
      }
    }
    // the invoice lines matched to each order / receipt line, grouped once (v19 filtered every line per line)
    const matchedBy = new Map();
    for (const pi of filteredPI) {
      const k = pi[piLineIdKey];
      if (!matchedBy.has(k)) matchedBy.set(k, []);
      matchedBy.get(k).push(pi);
    }
    const source = flattenWithParent(items, "item_id");
    const updated = source.map(({ row, parent }) => {
      const matchedPIs = matchedBy.get(row.id) || [];
      const directQty = matchedPIs.length > 0 ? absRound8(matchedPIs.reduce((s, pi) => s + (parseFloat(pi.invoice_qty) || 0), 0)) : 0;
      const distributedQty = distributedByRowId[row.id] || 0;
      const piInvoicedQty = absRound8(directQty + distributedQty);
      if (piInvoicedQty !== 0) {
        const currentInvoicedQty = absRound8(row.invoice_qty);
        const totalInvoicedQty = absRound8(currentInvoicedQty + piInvoicedQty);
        return { row: { ...row, invoice_qty: totalInvoicedQty }, parent };
      }
      return { row: { ...row }, parent };
    });
    let totalItems = 0;
    let partiallyInvoicedItems = 0;
    let fullyInvoicedItems = 0;
    for (const entry of updated) {
      if (entry.parent !== -1) continue;
      if (entry.row.parent_or_child === "Child") continue;
      totalItems++;
      if (absRound8(entry.row.invoice_qty) > 0) {
        partiallyInvoicedItems++;
        entry.row.pi_status = "Partially Invoiced";
        if (absRound8(entry.row.invoice_qty) >= absRound8(entry.row[qtyKey] || 0)) {
          fullyInvoicedItems++;
          entry.row.pi_status = "Fully Invoiced";
        }
      }
    }
    for (const entry of updated) {
      if (entry.parent === -1) continue;
      entry.row.pi_status = updated[entry.parent].row.pi_status;
    }
    const lineUpdates = [];
    for (const [index, entry] of updated.entries()) {
      const before = source[index].row;
      if (absRound8(entry.row.invoice_qty) === absRound8(before.invoice_qty) && String(entry.row.pi_status || "") === String(before.pi_status || "")) continue;
      lineUpdates.push({ id: entry.row.id, invoice_qty: qtyStr(entry.row.invoice_qty), pi_status: entry.row.pi_status || "" });
    }
    const allItemsComplete = fullyInvoicedItems === totalItems;
    const anyItemProcessing = partiallyInvoicedItems > 0;
    const newPIStatus = anyItemProcessing ? (allItemsComplete ? "Fully Invoiced" : "Partially Invoiced") : "";
    return { lineUpdates, newPIStatus };
  };
  const poHeaders = [];
  const poLines = [];
  for (const poID of poIds) {
    const poData = poList.find((po) => po.id === poID);
    if (!poData) continue;
    const { lineUpdates, newPIStatus } = processItems(poData.table_po || [], data.table_pi, poData.id, "line_po_id", "po_line_id", "quantity");
    poHeaders.push({ id: poData.id, pi_status: newPIStatus });
    poLines.push(...lineUpdates);
  }
  const grHeaders = [];
  const grLines = [];
  if (data.gr_id && data.gr_id.length > 0) {
    const grIds = Array.isArray(data.gr_id) ? data.gr_id : [data.gr_id];
    for (const grID of grIds) {
      const grData = grList.find((gr) => gr.id === grID);
      if (!grData) continue;
      const { lineUpdates, newPIStatus } = processItems(grData.table_gr || [], data.table_pi, grData.id, "line_gr_id", "gr_line_id", "received_qty");
      grHeaders.push({ id: grData.id, pi_status: newPIStatus });
      grLines.push(...lineUpdates);
    }
  }
  const flag = (rows) => (rows.length > 0 ? 1 : 0);
  return {
    status: "Success",
    allErrors: [],
    poHeaders,
    hasPoHeaders: flag(poHeaders),
    poLines,
    hasPoLines: flag(poLines),
    grHeaders,
    hasGrHeaders: flag(grHeaders),
    grLines,
    hasGrLines: flag(grLines),
  };
};
