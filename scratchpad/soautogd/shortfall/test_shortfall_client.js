// test_shortfall_client.js: the SO list's Convert (Goods Delivery/GDhandleConvertSOtoGD.js), Multiple GDs with
// convert_gd_created 1, page mocked. A GD Created V2 job that FAILED comes back from GD_SO_CONVERT_CHECK with its refused
// lines (job_lines_json, asked with job_lines "1"): stock lines become a table like the GD form's Insufficient Inventory
// Alert, in the line's unit; other lines are listed; a server without job_lines_json gives today's one-line reason.
// Run: node scratchpad/soautogd/shortfall/test_shortfall_client.js [handler.js]
const fs = require("fs"), assert = require("assert");
const SRC = fs.readFileSync(process.argv[2] || "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/GDhandleConvertSOtoGD.js", "utf8");
const IDS = { AUTO: "2076557490389835777", CHECK: "2112084100104495105", WORKER: "2104840667119411201" };

// The page's document: only what the handler may touch (a style element in head)
const makeDocument = () => {
  const head = [];
  return {
    head: { appendChild: (el) => head.push(el), children: head },
    getElementById: (id) => head.find((el) => el.id === id) || null,
    createElement: (tag) => ({ tagName: tag.toUpperCase(), id: "", textContent: "" }),
  };
};

// jobs: { J4: { job_status, error_message, error_count, lines: [...] } }; newServer false -> no job_lines_json at all
async function convert(opts) {
  const code = SRC.replace("const FOLLOW_EVERY_MS = 3000;", "const FOLLOW_EVERY_MS = 1;").replace("const FOLLOW_MS = 120000;", "const FOLLOW_MS = 2000;");
  const log = { checks: [], alerts: [] };
  const ctx = {
    showLoading: () => {}, hideLoading: () => {}, refresh: async () => {}, getVarGlobal: () => "admin",
    $alert: async (msg, title, o) => { log.alerts.push({ msg: String(msg), title, opts: o || {} }); },
    $confirm: async (msg, title, o) => { if (o && o.beforeClose) await o.beforeClose("cancel", {}, () => {}); },
    runWorkflow: (id, params, cb, err) => {
      setTimeout(() => {
        if (id === IDS.AUTO) {
          const all = opts.auto();
          const mine = (list) => (list || []).filter((x) => params.so_ids.indexOf(x.so_no.replace(/\D/g, "")) >= 0);
          return cb({ data: Object.assign({}, all, { created: mine(all.created), blocked: mine(all.blocked), queued: mine(all.queued) }) });
        }
        if (id === IDS.WORKER) return cb({ data: { code: "200" } });
        if (id === IDS.CHECK && params.so_ids) return cb({ data: { code: "200", message: "", busy_json: "[]", busy_count: "0", jobs_json: "[]", jobs_count: "0", run_json: "null" } });
        if (id === IDS.CHECK && params.job_ids) {
          log.checks.push(params);
          const jobs = params.job_ids.map((j) => {
            const s = opts.jobs[j];
            const errs = (s.lines || []).map((l) => ({ code: l.code, field: "temp_qty_data", line_no: l.line_no === "" ? null : Number(l.line_no), message: l.message, stable_line_key: l.line_no === "" ? "" : "L" + l.line_no }));
            return {
              job_id: j, job_status: s.job_status, gd_no: "", error_code: (s.lines && s.lines[0] && s.lines[0].code) || "", error_message: s.error_message || "",
              error_details: s.job_status === "FAILED" ? JSON.stringify({ line_errors: errs.slice(0, 10), line_error_count: s.error_count || errs.length }) : "",
              command: "CREATE_GD_FROM_FORM", progress_message: "",
            };
          });
          const data = { code: "200", message: "", busy_json: "[]", busy_count: "0", jobs_json: JSON.stringify(jobs), jobs_count: String(jobs.length), run_json: "null" };
          if (opts.newServer !== false) {
            const lines = [];
            for (const j of params.job_ids) {
              if (opts.jobs[j].job_status !== "FAILED") continue;
              for (const l of (opts.jobs[j].lines || []).slice(0, 10)) lines.push(Object.assign({ job_id: j }, l));
            }
            data.job_lines_json = JSON.stringify(lines);
          }
          return cb({ data });
        }
        err && err("unexpected workflow " + id);
      }, 0);
    },
  };
  global.window = {};
  global.document = opts.document || makeDocument();
  global.db = { collection: () => ({ where: () => ({ get: async () => ({ data: [{ picking_required: 0, convert_gd_created: 1 }] }) }) }) };
  const records = opts.sos.map((so) => ({ id: so.replace(/\D/g, ""), so_no: so, customer_name: { id: "C1" } }));
  new Function(code).call(ctx, { selectedRecords: records, plantID: "P1", organizationID: "O1" });
  for (let k = 0; k < 4000 && !log.alerts.length; k++) await new Promise((r) => setTimeout(r, 1));
  return log;
}

// The cells of every table row in the message (test utility: the handler's HTML read back as text)
const rowsOf = (msg) => (msg.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [])
  .map((tr) => (tr.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || []).map((td) => td.replace(/<[^>]+>/g, "").trim()))
  .filter((cells) => cells.length);
const stockLine = (no, code, name, uom, order, undelivered, toDeliver, base, available, requested) => ({
  line_no: String(no), code: "GD_INSUFFICIENT_STOCK", item_code: code, item_name: name, uom,
  order_qty: String(order), undelivered_qty: String(undelivered), delivery_qty: String(toDeliver), base_qty: String(base),
  message: `auto allocation: Insufficient stock for item ${code}. Available: ${available}, Requested: ${requested}`,
});
// SO-1 is created by the classic save; SO-4 (and SO-5) are queued and their jobs end as given
const oneFailed = (jobs, extra) => Object.assign({
  sos: ["SO-1", "SO-4", "SO-5"].slice(0, 2 + (jobs.J5 ? 1 : 0)),
  auto: () => ({ code: "200", created: [{ so_no: "SO-1", delivery_no: "GD/1" }], blocked: [], queued: Object.keys(jobs).map((j) => ({ so_no: "SO-" + j.slice(1), job_id: j })) }),
  jobs,
}, extra || {});

let n = 0;
const ok = (t) => { n++; console.log("ok", t); };

(async () => {
  // 1. one short line in the line's own unit
  let log = await convert(oneFailed({ J4: { job_status: "FAILED", error_message: "auto allocation: Insufficient stock for item FG-1001. Available: 25, Requested: 40",
    lines: [stockLine(1, "FG-1001", "Chilli Sauce 340g", "CTN", 50, 40, 40, 40, 25, 40)] } }));
  let a = log.alerts[0];
  assert.strictEqual(a.title, "Converted with Exceptions");
  assert.ok(/SO-4<\/strong> — not enough stock for 1 item/.test(a.msg), a.msg);
  assert.deepStrictEqual(rowsOf(a.msg), [["FG-1001", "Chilli Sauce 340g", "CTN", "50", "40", "40", "25", "15"]]);
  assert.ok(/Created 1 goods delivery/.test(a.msg) && /GD\/1/.test(a.msg), "the created part is unchanged: " + a.msg);
  assert.ok(/Convert one of these on its own to open the form, where you can deliver the available quantity\./.test(a.msg), a.msg);
  assert.deepStrictEqual(log.checks.map((p) => p.job_lines), ["1"], "the follow asks the check for the refused lines");
  ok("a short line: GD-form columns, quantities in the line's unit, shortfall = remaining demand - available");

  // 2. the line is in CTN (12 PCS each): the save reports PCS, the table shows CTN
  log = await convert(oneFailed({ J4: { job_status: "FAILED", error_message: "x",
    lines: [stockLine(1, "FG-2040", "Soy Sauce 1L", "CTN", 10, 10, 10, 120, 60, 120)] } }));
  assert.deepStrictEqual(rowsOf(log.alerts[0].msg), [["FG-2040", "Soy Sauce 1L", "CTN", "10", "10", "10", "5", "5"]]);
  ok("base-unit Available (60 PCS) is shown in the line's unit (5 CTN)");

  // 3. two short lines of one sales order; float residue in the save's figure
  log = await convert(oneFailed({ J4: { job_status: "FAILED", error_message: "x", lines: [
    stockLine(1, "FG-2040", "Soy Sauce 1L", "CTN", 12, 12, 12, 12, 0, 12),
    stockLine(2, "FG-2041", "Oyster Sauce 500g", "KG", 1, 0.5, 0.5, 0.5, "0.30000000000000004", 0.5)] } }));
  a = log.alerts[0];
  assert.ok(/SO-4<\/strong> — not enough stock for 2 items/.test(a.msg), a.msg);
  assert.deepStrictEqual(rowsOf(a.msg), [["FG-2040", "Soy Sauce 1L", "CTN", "12", "12", "12", "0", "12"], ["FG-2041", "Oyster Sauce 500g", "KG", "1", "0.5", "0.5", "0.3", "0.2"]]);
  ok("two short lines: two rows; 0.30000000000000004 shows as 0.3, the shortfall as 0.2");

  // 4. a short line and an invalid-unit line: the table, then the other line listed with its line number and item
  log = await convert(oneFailed({ J4: { job_status: "FAILED", error_message: "x", lines: [
    stockLine(1, "FG-1001", "Chilli Sauce 340g", "CTN", 50, 40, 40, 40, 25, 40),
    { line_no: "3", code: "GD_INVALID_UOM", item_code: "FG-2", item_name: "Kicap", uom: "BOX", order_qty: "5", undelivered_qty: "5", delivery_qty: "5", base_qty: "5",
      message: "unit CTN has no conversion to the base unit of the material" }] } }));
  a = log.alerts[0];
  assert.ok(/SO-4<\/strong> — 2 lines need correcting/.test(a.msg), a.msg);
  assert.deepStrictEqual(rowsOf(a.msg), [["FG-1001", "Chilli Sauce 340g", "CTN", "50", "40", "40", "25", "15"]]);
  assert.ok(/Line 3 \(FG-2\): unit CTN has no conversion to the base unit of the material/.test(a.msg), a.msg);
  ok("mixed refusal: stock lines in the table, the other line listed as Line 3 (FG-2): message");

  // 5. a stock refusal in another shape (an allocation at a bin): listed as is, no table
  log = await convert(oneFailed({ J4: { job_status: "FAILED", error_message: "x", lines: [
    { line_no: "1", code: "GD_INSUFFICIENT_STOCK", item_code: "FG-9", item_name: "Garam", uom: "PCS", order_qty: "8", undelivered_qty: "8", delivery_qty: "8", base_qty: "8",
      message: "allocation 1: unrestricted stock 5 at bin 99 is less than the 8 requested by this delivery" }] } }));
  a = log.alerts[0];
  assert.deepStrictEqual(rowsOf(a.msg), []);
  assert.ok(/SO-4<\/strong> — 1 line needs correcting/.test(a.msg) && /Line 1 \(FG-9\): allocation 1: unrestricted stock 5 at bin 99 is less than the 8 requested by this delivery/.test(a.msg), a.msg);
  assert.ok(!a.opts.customClass, "no table, no wide window");
  ok("a stock message that does not parse: shown as the save wrote it, no table");

  // 6. 14 refused lines, the first 10 sent
  const many = Array.from({ length: 10 }, (_, i) => stockLine(i + 1, "FG-" + (i + 1), "Item " + (i + 1), "PCS", 9, 9, 9, 9, 1, 9));
  log = await convert(oneFailed({ J4: { job_status: "FAILED", error_message: "x", error_count: 14, lines: many } }));
  a = log.alerts[0];
  assert.strictEqual(rowsOf(a.msg).length, 10);
  assert.ok(/SO-4<\/strong> — not enough stock for 14 items/.test(a.msg) && /… and 4 more/.test(a.msg), a.msg);
  ok("14 refused lines, 10 sent: 10 rows, the title counts 14, '… and 4 more'");

  // 7. a header refusal (credit limit, no line number): today's reason
  log = await convert(oneFailed({ J4: { job_status: "FAILED", error_message: "Credit limit exceeded for this customer",
    lines: [{ line_no: "", code: "GD_CREDIT_LIMIT_BLOCKED", item_code: "", item_name: "", uom: "", order_qty: "", undelivered_qty: "", delivery_qty: "", base_qty: "", message: "Credit limit exceeded for this customer" }] } }));
  a = log.alerts[0];
  assert.ok(/SO-4 — Credit limit exceeded for this customer/.test(a.msg) && rowsOf(a.msg).length === 0 && !a.opts.customClass, a.msg);
  ok("a header refusal (no line): today's one-line reason, today's window");

  // 8. a check without job_lines_json (not yet published): today's one-line reason
  log = await convert(oneFailed({ J4: { job_status: "FAILED", error_message: "auto allocation: Insufficient stock for item FG-1001. Available: 25, Requested: 40",
    lines: [stockLine(1, "FG-1001", "Chilli Sauce 340g", "CTN", 50, 40, 40, 40, 25, 40)] } }, { newServer: false }));
  a = log.alerts[0];
  assert.ok(/SO-4 — auto allocation: Insufficient stock for item FG-1001\. Available: 25, Requested: 40/.test(a.msg) && rowsOf(a.msg).length === 0 && !a.opts.customClass, a.msg);
  ok("an older check (no job_lines_json): today's text, unchanged");

  // 9. every sales order refused: the error window carries the tables too
  log = await convert({ sos: ["SO-4", "SO-5"], auto: () => ({ code: "200", created: [], blocked: [], queued: [{ so_no: "SO-4", job_id: "J4" }, { so_no: "SO-5", job_id: "J5" }] }),
    jobs: { J4: { job_status: "FAILED", error_message: "x", lines: [stockLine(1, "FG-1001", "Chilli Sauce 340g", "CTN", 50, 40, 40, 40, 25, 40)] },
      J5: { job_status: "FAILED", error_message: "Credit limit exceeded", lines: [] } } });
  a = log.alerts[0];
  assert.strictEqual(a.title, "Could Not Convert to Goods Delivery");
  assert.deepStrictEqual(rowsOf(a.msg), [["FG-1001", "Chilli Sauce 340g", "CTN", "50", "40", "40", "25", "15"]]);
  assert.ok(/SO-5<\/strong><br>Credit limit exceeded/.test(a.msg), a.msg);
  ok("nothing converted: the error window shows the table, other reasons as today");

  // 10. names are escaped
  log = await convert(oneFailed({ J4: { job_status: "FAILED", error_message: "x", lines: [stockLine(1, "FG<1>", "<b>Bold</b> & Co", "CTN", 2, 2, 2, 2, 1, 2)] } }));
  a = log.alerts[0];
  assert.ok(a.msg.includes("&lt;b&gt;Bold&lt;/b&gt; &amp; Co") && a.msg.includes("FG&lt;1&gt;") && !a.msg.includes("<b>Bold"), a.msg);
  ok("item code and name are HTML-escaped");

  // 11. the wide window: a class on the box, its style added to the page once
  const doc = makeDocument();
  const short = { J4: { job_status: "FAILED", error_message: "x", lines: [stockLine(1, "FG-1001", "Chilli Sauce 340g", "CTN", 50, 40, 40, 40, 25, 40)] } };
  log = await convert(oneFailed(short, { document: doc }));
  const cls = log.alerts[0].opts.customClass;
  assert.ok(cls && typeof cls === "string", "a table opens the wide window");
  log = await convert(oneFailed(short, { document: doc }));
  const styles = doc.head.children.filter((el) => el.tagName === "STYLE");
  assert.strictEqual(styles.length, 1, "one style element across two converts");
  assert.ok(styles[0].textContent.includes("." + cls), styles[0].textContent);
  ok("a table widens the window: customClass on the box, its style added once");

  // 12. a page without document.head still shows the result, and says why the window is not wider
  const logged = [];
  const consoleError = console.error;
  console.error = (...args) => logged.push(args.map(String).join(" "));
  try {
    log = await convert(oneFailed(short, { document: {} }));
  } finally {
    console.error = consoleError;
  }
  assert.deepStrictEqual(rowsOf(log.alerts[0].msg), [["FG-1001", "Chilli Sauce 340g", "CTN", "50", "40", "40", "25", "15"]]);
  assert.ok(logged.some((t) => /could not be widened/.test(t)), JSON.stringify(logged));
  ok("no document.head: the table still shows (the window is just not widened, and that is logged)");

  console.log(n + " passed");
})().catch((e) => { console.error(e); process.exit(1); });
