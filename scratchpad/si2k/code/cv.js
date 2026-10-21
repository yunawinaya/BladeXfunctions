// Rows from a sql-node (one JSON text per row) in the shape the old search nodes gave: null and "" keys left off, bigint
// columns as exact strings from 16 digits up and as numbers below that, a document's lines under its line key with a bundle's
// items under `children`, documents and lines in id order.
const cvParse = function cvParse(t) {
  if (t && typeof t === "object") return t;
  try {
    return JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));
  } catch (e) {
    return null;
  }
};
const cvRows = function cvRows(rows, bigints) {
  const big = new Set(bigints || []);
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const o = cvParse(r && r.j !== undefined ? r.j : r);
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
const cvDocs = function cvDocs(headRows, lineRows, lineKey, headBigints, lineBigints) {
  const heads = cvRows(headRows, headBigints);
  const byDoc = new Map();
  for (const l of cvRows(lineRows, (lineBigints || []).concat(["doc"]))) {
    const doc = String(l.doc);
    delete l.doc;
    if (!byDoc.has(doc)) byDoc.set(doc, []);
    byDoc.get(doc).push(l);
  }
  return heads.map((h) => {
    const lines = byDoc.get(String(h.id)) || [];
    const present = new Set(lines.map((l) => String(l.id)));
    const kids = new Map();
    for (const l of lines) {
      if (l.parent_id === undefined || !present.has(String(l.parent_id))) continue;
      if (!kids.has(String(l.parent_id))) kids.set(String(l.parent_id), []);
      kids.get(String(l.parent_id)).push(l);
    }
    const top = lines.filter((l) => l.parent_id === undefined || !present.has(String(l.parent_id)));
    return Object.assign({}, h, { [lineKey]: top.map((l) => (kids.has(String(l.id)) ? Object.assign({}, l, { children: kids.get(String(l.id)) }) : l)) });
  });
};
