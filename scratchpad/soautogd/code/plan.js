// SO_AUTO_GD V2 plan: a delivery goes to GD Created V2 (GD_ASYNC_SUBMIT) when the GD form's own V2 route accepts it and the
// V2 fit finds nothing GD_BULK_PREPARE would refuse, else to the classic save as before; gdV2Dec / gdV2Route / gdV2LineCount /
// gdV2Payload are copied verbatim from the form, gdV2FitLines / gdV2Fit from GD_ASYNC_SUBMIT's own fit (v2fit_lib.js)
@@GDV2_FUNCTIONS@@
@@GDV2_FIT@@
const GD_V2_MAX_LINES = 2000;
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const v2On = s([{{workflowparams:v2}}][0]) === "1";
const org = s([{{workflowparams:organization_id}}][0]);
const payloads = asList([{{node:code_build.data.payloads}}][0]);
const itemFlags = {};
for (const it of asList([{{node:sql_node_Items.data}}][0])) {
  if (it && s(it.id)) itemFlags[s(it.id)] = { stock_control: s(it.stock_control), show_delivery: s(it.show_delivery) };
}
const facts = asList([{{node:sql_v2facts.data}}][0]);
const hash = (text) => {
  let h1 = 2166136261;
  let h2 = 5381;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = (Math.imul(h2, 33) + c) >>> 0;
  }
  return ("00000000" + h1.toString(16)).slice(-8) + ("00000000" + h2.toString(16)).slice(-8);
};
const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const out = [];
const blocked = [];
let v2Count = 0;
payloads.forEach((p, i) => {
  const so = s(p && p.so_no);
  const classic = (why) => out.push({ so_no: so, allData: p.allData, route: "CLASSIC", reason: why, v2Key: "", v2Payload: "", v2Plant: "" });
  if (!v2On) return classic("V2 switched off");
  const r = gdV2Route(p.allData, { saveAs: "Created", isAdd: true, organizationId: org, enabled: true, itemFlags: itemFlags });
  if (r.route !== "ASYNC") return classic(r.reason);
  const payload = gdV2Payload(p.allData, { organizationId: org, allocationMode: "RESERVE" });
  const why = gdV2Fit(gdV2FitLines(payload).rows, facts);
  if (why) return classic(why);
  if (gdV2LineCount(p.allData) > GD_V2_MAX_LINES) {
    blocked.push({ so_no: so, reason: "More than " + GD_V2_MAX_LINES + " lines in one goods delivery. Convert this sales order through the Convert form, in parts." });
    return;
  }
  const text = JSON.stringify(payload);
  v2Count++;
  out.push({
    so_no: so,
    allData: null,
    route: "V2",
    reason: r.reason,
    v2Key: ("SOA:" + org + ":" + so.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 40) + ":" + hash(text) + ":" + nonce + "-" + i).slice(0, 128),
    v2Payload: text,
    v2Plant: s(payload.header.plant_id),
  });
});
return { payloads: out, blocked: blocked, v2Count: v2Count, classicCount: out.length - v2Count };
