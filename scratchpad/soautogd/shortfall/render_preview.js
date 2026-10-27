// render_preview.js: runs the real handler (Goods Delivery/GDhandleConvertSOtoGD.js) on a made-up convert - 1 created, a short
// sales order with two lines (one in CTN of 12 PCS), a mixed refusal, a credit-limit refusal - and writes preview.html, which
// opens the captured $alert (message, title, options, and the style element the handler added) in Element Plus, the dev
// platform's message box, for a screenshot. Usage: node render_preview.js <out.html>
const fs = require("fs");
const SRC = fs.readFileSync("/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/GDhandleConvertSOtoGD.js", "utf8")
  .replace("const FOLLOW_EVERY_MS = 3000;", "const FOLLOW_EVERY_MS = 1;");
const out = process.argv[2] || "preview.html";
const stock = (no, code, name, uom, order, und, qty, base, avail, req) => ({ line_no: String(no), code: "GD_INSUFFICIENT_STOCK", item_code: code, item_name: name, uom,
  order_qty: String(order), undelivered_qty: String(und), delivery_qty: String(qty), base_qty: String(base),
  message: `auto allocation: Insufficient stock for item ${code}. Available: ${avail}, Requested: ${req}` });
const LINES = {
  J4: [stock(1, "FG-2040", "Soy Sauce 1L", "CTN", 12, 12, 12, 144, 0, 144), stock(2, "FG-2041", "Oyster Sauce 500g", "CTN", 100, 60, 60, 720, 576, 720)],
  J5: [stock(1, "FG-1001", "Chilli Sauce 340g", "CTN", 50, 40, 40, 40, 25, 40),
    { line_no: "3", code: "GD_INVALID_UOM", item_code: "FG-3001", item_name: "Kicap Manis", uom: "BOX", order_qty: "5", undelivered_qty: "5", delivery_qty: "5", base_qty: "5",
      message: "unit BOX has no conversion to the base unit of the material" }],
  J6: [{ line_no: "", code: "GD_CREDIT_LIMIT_BLOCKED", item_code: "", item_name: "", uom: "", order_qty: "", undelivered_qty: "", delivery_qty: "", base_qty: "", message: "Credit limit exceeded for customer Kedai Ah Seng" }],
};
const ERR = { J4: "x", J5: "x", J6: "Credit limit exceeded for customer Kedai Ah Seng" };
const head = [];
global.document = { head: { appendChild: (el) => head.push(el) }, getElementById: (id) => head.find((e) => e.id === id) || null, createElement: (t) => ({ tagName: t, id: "", textContent: "" }) };
global.window = {};
global.db = { collection: () => ({ where: () => ({ get: async () => ({ data: [{ picking_required: 0, convert_gd_created: 1 }] }) }) }) };
const ctx = {
  showLoading: () => {}, hideLoading: () => {}, refresh: async () => {}, getVarGlobal: () => "admin",
  $confirm: async (m, t, o) => { if (o && o.beforeClose) await o.beforeClose("cancel", {}, () => {}); },
  $alert: async (msg, title, opts) => {
    const style = head.length ? head[0].textContent : "";
    const page = `<!doctype html><html><head><meta charset="utf-8"><title>Convert result preview</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/element-plus@2.4.4/dist/index.css">
<style>body{font-family:Helvetica,Arial,sans-serif;background:#f0f2f5;margin:0}</style><style id="handler-style">${style}</style></head><body>
<script src="https://cdn.jsdelivr.net/npm/vue@3.3.13/dist/vue.global.prod.js"></script>
<script src="https://cdn.jsdelivr.net/npm/element-plus@2.4.4/dist/index.full.min.js"></script>
<script>
const app = Vue.createApp({}); app.use(ElementPlus); app.mount(document.body.appendChild(document.createElement("div")));
ElementPlus.ElMessageBox.alert(${JSON.stringify(msg)}, ${JSON.stringify(title)}, ${JSON.stringify(opts)});
</script></body></html>`;
    fs.writeFileSync(out, page);
    console.log("wrote", out, "title:", title, "customClass:", opts.customClass || "(none)");
  },
  runWorkflow: (id, params, cb) => setTimeout(() => {
    if (id === "2076557490389835777") return cb({ data: { code: "200", created: [{ so_no: "SO/20261026/0101", delivery_no: "GD/20261026/0451" }].filter((c) => params.so_ids.includes("1")), blocked: [],
      queued: [["J4", "4"], ["J5", "5"], ["J6", "6"]].filter(([, s]) => params.so_ids.includes(s)).map(([j, s]) => ({ so_no: "SO/20261026/010" + s, job_id: j })) } });
    if (id === "2104840667119411201") return cb({ data: {} });
    if (params.so_ids) return cb({ data: { busy_json: "[]" } });
    const jobs = params.job_ids.map((j) => ({ job_id: j, job_status: "FAILED", gd_no: "", error_code: LINES[j][0].code, error_message: ERR[j],
      error_details: JSON.stringify({ line_errors: [], line_error_count: LINES[j].length }), command: "CREATE_GD_FROM_FORM", progress_message: "" }));
    const lines = [].concat(...params.job_ids.map((j) => LINES[j].map((l) => Object.assign({ job_id: j }, l))));
    return cb({ data: { jobs_json: JSON.stringify(jobs), job_lines_json: JSON.stringify(lines) } });
  }, 0),
};
const NAMES = { 1: "Kedai Ah Seng", 4: "Restoran Maju Jaya", 5: "Syarikat Lim Bersaudara", 6: "Pasar Mini Sri Aman" };
const records = ["1", "4", "5", "6"].map((s) => ({ id: s, so_no: "SO/20261026/010" + s, customer_name: { id: "C" + s, customer_com_name: NAMES[s] } }));
new Function(SRC).call(ctx, { selectedRecords: records, plantID: "P1", organizationID: "O1" });
