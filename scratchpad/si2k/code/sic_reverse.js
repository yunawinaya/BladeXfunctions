// SI_CANCEL v10 "Reverse": v9's Map Latest SO/GD list (code_node_CtfkSP3q), reading the invoice, the orders, the deliveries and
// the receivables from sql-nodes that hold only the columns it uses, put back into the shape the old get / search nodes gave
// (null and "" keys left off, bigint ids as numbers below 16 digits, a bundle's items under `children`, id order). v9 wrote every
// order / delivery line back through table_so / table_gd; here only the lines whose invoiced quantity, status or posted quantity
// moves are written, through the line collections. A status v9 cleared (null, stored as NULL) is written as "".
const sicParse = function sicParse(t) {
  if (t && typeof t === "object") return t;
  try {
    return JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));
  } catch (e) {
    return null;
  }
};
const sicRows = function sicRows(rows, bigints) {
  const big = new Set(bigints || []);
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const o = sicParse(r && r.j !== undefined ? r.j : r);
    if (!o) continue;
    const row = {};
    for (const k of Object.keys(o)) {
      let v = o[k];
      if (v === null || v === undefined || v === "") continue;
      if (big.has(k) && typeof v === "string" && /^-?\d{1,15}$/.test(v)) v = Number(v);
      row[k] = v;
    }
    out.push(row);
  }
  return out;
};
const sicDocs = function sicDocs(rows, lineKey, bigints) {
  const docs = [];
  const byDoc = new Map();
  for (const o of sicRows(rows, (bigints || []).concat(["doc"]))) {
    const key = String(o.doc);
    if (!byDoc.has(key)) {
      const doc = { id: o.doc, lines: [] };
      byDoc.set(key, doc);
      docs.push(doc);
    }
    if (o.id === undefined) continue;
    const line = Object.assign({}, o);
    delete line.doc;
    byDoc.get(key).lines.push(line);
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
    return { id: doc.id, [lineKey]: top.map((l) => (kids.has(String(l.id)) ? Object.assign({}, l, { children: kids.get(String(l.id)) }) : l)) };
  });
};
const sicReverse = function sicReverse(siHeadRows, siLineRows, soRows, gdRows, arRows) {
  const head = sicRows(siHeadRows, ["id"])[0];
  // the get-node's record: the invoice with its lines (a bundle's items under `children`)
  const data = head ? Object.assign({}, head, { table_si: ((sicDocs(siLineRows, "table_si", ["id", "parent_id", "so_line_id", "line_gd_id",
    "gd_line_id"])[0] || {}).table_si) || [] }) : {};
  const soList = sicDocs(soRows, "table_so", ["id", "parent_id"]);
  const gdList = sicDocs(gdRows, "table_gd", ["id", "parent_id"]);
  const arList = sicRows(arRows, ["id"]);

  // ---- code_node_CtfkSP3q (v9) ----
  const roundTo3 = (value) => {
    return Math.round((parseFloat(value) || 0) * 1000) / 1000;
  };
  const updateGoodsDelivery = (gdIds, tableSi, data) => {
    let gdUpdatedList = [];
    for (const gdID of gdIds) {
      const gdData = gdList.find((gd) => gd.id === gdID) || [];
      const gdItems = (gdData && gdData.table_gd) || [];
      const { updatedItems, newSIStatus } = processItems(gdItems, tableSi, gdData.id, "line_gd_id", "gd_line_id", "gd_qty", data.si_status);
      gdUpdatedList.push({ gd_id: gdData.id, si_status: newSIStatus, items: gdItems, updatedItems });
    }
    return gdUpdatedList;
  };
  const updateSalesOrder = (soIds, tableSi, data) => {
    let soUpdatedList = [];
    for (const soID of soIds) {
      const soData = soList.find((so) => so.id === soID);
      const soItems = soData.table_so || [];
      const { updatedItems, newSIStatus } = processItems(soItems, tableSi, soData.id, "line_so_id", "so_line_id", "so_quantity", data.si_status);
      soUpdatedList.push({ so_id: soData.id, si_status: newSIStatus, items: soItems, updatedItems });
    }
    return soUpdatedList;
  };
  const processItems = (items, tableSi, docId, docIdKey, siLineIdKey, qtyKey, siStatus) => {
    const filteredSI = tableSi.filter((item) => item[docIdKey] === docId);
    let totalItems = items.length;
    // the first invoice line pointing at each order line (v9 searched the invoice per order line)
    const firstSI = new Map();
    for (const si of filteredSI) if (!firstSI.has(si[siLineIdKey])) firstSI.set(si[siLineIdKey], si);
    const updatedItems = items.map((item) => {
      const matchedSI = firstSI.get(item.id);
      if (matchedSI) {
        const siInvoicedQty = roundTo3(matchedSI.invoice_qty);
        const currentInvoicedQty = roundTo3(item.invoice_qty);
        const totalInvoicedQty = roundTo3(currentInvoicedQty - siInvoicedQty);
        let updatedItem = { ...item, invoice_qty: totalInvoicedQty };
        if (siStatus === "Posted") {
          const currentPostedQty = roundTo3(item.posted_qty || 0);
          const totalPostedQty = roundTo3(currentPostedQty - siInvoicedQty);
          updatedItem.posted_qty = totalPostedQty;
        }
        if (roundTo3(updatedItem.invoice_qty) > 0) {
          updatedItem.si_status = "Partially Invoiced";
          if (roundTo3(updatedItem.invoice_qty) >= roundTo3(item[qtyKey] || 0)) {
            updatedItem.si_status = "Fully Invoiced";
          }
        } else {
          updatedItem.si_status = null;
        }
        return updatedItem;
      }
      return { ...item };
    });
    let partiallyInvoicedItems = updatedItems.filter((item) => item.si_status === "Partially Invoiced").length;
    let fullyInvoicedItems = updatedItems.filter((item) => item.si_status === "Fully Invoiced").length;
    const allItemsComplete = fullyInvoicedItems === totalItems;
    const anyItemProcessing = partiallyInvoicedItems > 0 || fullyInvoicedItems > 0;
    let newSIStatus = anyItemProcessing ? (allItemsComplete ? "Fully Invoiced" : "Partially Invoiced") : "";
    return { updatedItems, newSIStatus };
  };
  const soIds = Array.isArray(data.so_id) ? data.so_id : [data.so_id];
  let updatedGD = [];
  if (data.gd_id && data.gd_id.length > 0) {
    const gdIds = Array.isArray(data.gd_id) ? data.gd_id : [data.gd_id];
    updatedGD = updateGoodsDelivery(gdIds, data.table_si, data);
  }
  const updatedSO = updateSalesOrder(soIds, data.table_si, data);
  const updatedAR = arList.map((ar) => ({ id: ar.id, ar_invoice_no: ar.ar_invoice_no + "-Cancelled" }));

  // what moved, line by line (v9 wrote every line back)
  const q8 = (v) => (Math.round((parseFloat(v) || 0) * 100000000) / 100000000).toFixed(8);
  const st = (v) => (v === undefined || v === null ? "" : String(v));
  const moved = (docs, withPosted) => {
    const lines = [];
    const posted = [];
    for (const d of docs) {
      d.updatedItems.forEach((row, i) => {
        const before = d.items[i];
        if (roundTo3(row.invoice_qty) !== roundTo3(before.invoice_qty) || parseFloat(row.invoice_qty || 0) !== parseFloat(before.invoice_qty || 0) ||
          st(row.si_status) !== st(before.si_status)) {
          lines.push({ id: row.id, invoice_qty: q8(row.invoice_qty), si_status: st(row.si_status) });
        }
        if (withPosted && row.posted_qty !== undefined && parseFloat(row.posted_qty) !== parseFloat(before.posted_qty || 0)) {
          posted.push({ id: row.id, posted_qty: q8(row.posted_qty) });
        }
      });
    }
    return { lines, posted };
  };
  const so = moved(updatedSO, true);
  const gd = moved(updatedGD, false);
  const soHeaders = updatedSO.map((d) => ({ id: d.so_id, si_status: d.si_status }));
  const gdHeaders = updatedGD.filter((d) => d.gd_id !== undefined).map((d) => ({ id: d.gd_id, si_status: d.si_status }));
  const flag = (rows) => (rows.length > 0 ? 1 : 0);
  return {
    updatedSI: { id: data.id, si_status: "Cancelled", sales_invoice_no: data.sales_invoice_no + "-Cancelled" },
    updatedAR,
    hasAR: flag(updatedAR),
    soHeaders,
    hasSoHeaders: flag(soHeaders),
    soLines: so.lines,
    hasSoLines: flag(so.lines),
    soPosted: so.posted,
    hasSoPosted: flag(so.posted),
    gdHeaders,
    hasGdHeaders: flag(gdHeaders),
    gdLines: gd.lines,
    hasGdLines: flag(gd.lines),
  };
};
