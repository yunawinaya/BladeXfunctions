// PO_LINE_IMPORT - Guard: the Excel rows as the PO form's upload parsed them, each checked on its own (headers matched
// without case, spaces or punctuation), and the distinct item codes for the item read
const IMPORT_MAX_ROWS = 2500;
const ERRORS_SHOWN = 30;
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const digits = (v) => /^[0-9]{1,20}$/.test(s(v));
const normKey = (k) => String(k || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const HEADERS = {
  code: ["itemcode", "code", "materialcode", "item"],
  qty: ["quantity", "qty"],
  uom: ["uom", "unit", "unitofmeasure", "unitofmeasurement", "quantityuom"],
  price: ["unitprice", "price"],
  discount: ["discount"],
  discountType: ["discounttype", "discountuom"],
  desc: ["description", "itemdescription"],
  remark1: ["remark1", "remark", "remarks", "lineremark1"],
  remark2: ["remark2", "lineremark2"],
  date: ["requireddeliverydate", "deliverydate", "expecteddeliverydate", "requireddate"],
};
const FIELD_OF = {};
for (const f of Object.keys(HEADERS)) for (const h of HEADERS[f]) FIELD_OF[h] = f;
const TEMPLATE = "Item Code, Quantity, UOM, Unit Price, Discount, Discount Type, Description, Remark 1, Remark 2, Required Delivery Date";
// a number as Excel or a person writes it: 1,250.5 -> 1250.5; blank -> null; anything else -> NaN
const numOf = (v) => {
  if (typeof v === "number") return isFinite(v) ? v : NaN;
  const t = s(v).replace(/,/g, "");
  if (t === "") return null;
  return /^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(t) ? Number(t) : NaN;
};
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
// a calendar date -> "YYYY-MM-DD"; blank -> ""; not a date -> null. Excel day numbers, ISO, day-month-year with - / or .,
// "1 Jan 2026" and "Jan 1, 2026"
const dateOf = (v) => {
  const p2 = (n) => (n < 10 ? "0" : "") + n;
  const ymd = (y, m, d) => {
    if (!(y >= 1900 && y <= 2999 && m >= 1 && m <= 12 && d >= 1)) return null;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return d <= last ? y + "-" + p2(m) + "-" + p2(d) : null;
  };
  if (typeof v === "number") {
    if (!(v >= 1 && v < 2958466)) return null;
    const t = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
    return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  const t = s(v);
  if (t === "") return "";
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return ymd(+m[3], +m[2], +m[1]);
  m = t.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s,-]+(\d{4})$/);
  if (m && MONTHS[m[2].slice(0, 4).toLowerCase()] !== undefined) return ymd(+m[3], MONTHS[m[2].slice(0, 4).toLowerCase()], +m[1]);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()] !== undefined) return ymd(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);
  m = t.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()] !== undefined) return ymd(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
  return null;
};
const sqlText = (v) => String(v).replace(/\\/g, "\\\\").replace(/'/g, "''");

const importGuard = function importGuard(input) {
  const base = { route: "STOP", code: "400", message: "", errors: [], rows: [], codesSql: "[]", count: 0, tenantId: "", organizationId: "", supplierId: "", plantId: "" };
  const stop = (message, errors) => Object.assign(base, { message: message, errors: errors || [] });
  if (!digits(input.tenantId)) return stop("No session tenant.");
  if (!digits(input.organizationId)) return stop("The organization of this purchase order is not set.");
  if (s(input.supplierId) !== "" && !digits(input.supplierId)) return stop("The supplier of this purchase order is not valid.");
  if (s(input.plantId) !== "" && !digits(input.plantId)) return stop("The plant of this purchase order is not valid.");
  let raw = input.rows;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch (e) {
      return stop("The uploaded file could not be read.");
    }
  }
  if (!Array.isArray(raw)) return stop("The uploaded file could not be read.");
  const out = [];
  const errors = [];
  const unknownHeaders = {};
  let sawCode = false;
  raw.forEach((r, i) => {
    if (!r || typeof r !== "object") return;
    const n = i + 2; // row 1 is the header row
    const v = {};
    for (const k of Object.keys(r)) {
      const f = FIELD_OF[normKey(k)];
      if (f) {
        if (f === "code") sawCode = true;
        if (v[f] === undefined || s(v[f]) === "") v[f] = r[k];
      } else if (s(r[k]) !== "") unknownHeaders[k] = true;
    }
    if (Object.keys(v).every((f) => s(v[f]) === "")) return; // a blank row
    const err = (msg) => errors.push({ row: n, message: msg });
    const code = s(v.code);
    if (!code) return err("Item Code is empty");
    if (code.length > 255) return err("Item Code is longer than 255 characters");
    const qty = numOf(v.qty);
    if (qty === null) return err("Quantity is empty");
    if (!(qty > 0)) return err("Quantity must be a number above 0 (" + s(v.qty) + ")");
    const price = numOf(v.price);
    if (price !== null && !(price >= 0)) return err("Unit Price must be a number, 0 or above (" + s(v.price) + ")");
    const discount = numOf(v.discount);
    if (discount !== null && !(discount >= 0)) return err("Discount must be a number, 0 or above (" + s(v.discount) + ")");
    let discountType = "";
    const dt = normKey(v.discountType);
    if (s(v.discountType)) {
      if (s(v.discountType) === "%" || dt === "percent" || dt === "percentage" || dt === "pct") discountType = "%";
      else if (dt === "amount" || dt === "amt" || dt === "value") discountType = "Amount";
      else return err("Discount Type must be % or Amount (" + s(v.discountType) + ")");
    }
    if (discountType === "%" && discount !== null && discount > 100) return err("Discount above 100%");
    const date = dateOf(v.date);
    if (date === null) return err("Required Delivery Date is not a date (" + s(v.date) + ")");
    out.push({ n: n, code: code, qty: qty, uom: s(v.uom), price: price, discount: discount, discountType: discountType, desc: s(v.desc), remark1: s(v.remark1),
      remark2: s(v.remark2), date: date });
  });
  if (!sawCode) return stop("The file has no Item Code column. The template's columns are: " + TEMPLATE + ".");
  if (out.length + errors.length === 0) return stop("The file has no lines.");
  if (out.length + errors.length > IMPORT_MAX_ROWS) return stop("The file has " + (out.length + errors.length) + " lines. At most " + IMPORT_MAX_ROWS + " lines can be imported at once.");
  if (errors.length) return stop(errors.length + " line(s) cannot be imported - nothing was added.", errors);
  const codes = [...new Set(out.map((r) => r.code))];
  const parts = [];
  for (let i = 0; i < codes.length; i += 50) parts.push(codes.slice(i, i + 50).map((c) => JSON.stringify({ c: c })).join(","));
  return Object.assign(base, { route: "GO", code: "200", message: Object.keys(unknownHeaders).length ? "Columns not imported: " + Object.keys(unknownHeaders).join(", ") : "",
    rows: out, codesSql: sqlText("[" + parts.join(",\n") + "]"), count: out.length, tenantId: s(input.tenantId), organizationId: s(input.organizationId),
    supplierId: s(input.supplierId), plantId: s(input.plantId) });
};
const res = importGuard({ rows: [{{workflowparams:rows}}][0], tenantId: [{{system:tenantId}}][0], organizationId: [{{workflowparams:organization_id}}][0],
  supplierId: [{{workflowparams:supplier_id}}][0], plantId: [{{workflowparams:plant_id}}][0] });
res.errorsShown = res.errors.slice(0, ERRORS_SHOWN);
res.errorsJson = JSON.stringify(res.errorsShown);
res.errorCount = String(res.errors.length);
console.log("import guard", JSON.stringify({ route: res.route, count: res.count, errors: res.errors.length, message: res.message }));
return res;
