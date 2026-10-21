// One form session for the Small Cycle client tests: a world + a form `this` kept across several events, as a user clicking
// through one Item Assembly. fire(name, args) runs an event by NAME and drains the event loop.
const H = require("./harness");
const F = require("./fixture");

const ON_DOC = () => H.scVariant(H.readJSON(H.FILES.formOn), true, H.SC_TEST_IDS);
const session = (values, o) => {
  o = o || {};
  const doc = o.doc || ON_DOC();
  const w = H.world({ db: H.tableDb(o.tables || F.tables(), { clamp: o.clamp }), dbThrows: o.dbThrows, dbDelay: o.dbDelay });
  w.so = F.so(o.so);
  if (o.projectionDown) w.projectionDown = true;
  const confirms = o.confirms || {};
  const self = H.makeThis(w, doc, Object.assign({ values: H.clone(values), stateful: true, answer: F.answer(w, H.SC_TEST_IDS, o.answer), fireOnChange: !!o.fireOnChange,
    params: o.params, data: o.data, confirm: (m, t) => (typeof confirms[t] === "function" ? confirms[t](m) : confirms[t] || "confirm") }, o.this || {}));
  const s = {
    w: w, self: self, doc: doc,
    fire: async (name, args) => {
      s.start(name, args);
      await s.drain();
      return s;
    },
    // starts an event without waiting for it (two overlapping runs: start, start, then drain)
    start: (name, args) => {
      const e = H.byName(doc, name);
      if (!e) throw new Error("no event " + name);
      H.compile(w, H.sourceOf(e), e.type === "rule").call(self, args);
      return s;
    },
    // a run that never settles (an event loop: each write firing the next) is recorded, not thrown
    drain: async () => {
      try {
        await H.drain(w, 20000);
      } catch (e) {
        s.drainError = String(e && e.message);
        w.queue.length = 0;
        w.rec("drain-error", s.drainError);
      }
      return s;
    },
    v: () => self.values,
    mark: () => w.trace.length,
    since: (n) => w.trace.slice(n),
    calls: (name, n) => w.trace.slice(n || 0).filter((t) => t[0] === name || t[0] === "sc:" + name),
    reads: (collection, n) => w.trace.slice(n || 0).filter((t) => /db\.get$/.test(t[0]) && t[1].collection === collection),
    wf: (id, n) => w.trace.slice(n || 0).filter((t) => /runWorkflow$/.test(t[0]) && t[1] === id),
    text: (n) => JSON.stringify(w.trace.slice(n || 0)),
    // the info panel as the user sees it: "Label: value" per row shown (the last display / hide wins; at first, the widget's hidden);
    // the Sales Order card's rows, then the BOM row (in the Production section since UI-01)
    panel: () => {
      const rows = [];
      const walk = (n) => {
        if (Array.isArray(n)) n.forEach(walk);
        else if (n && typeof n === "object") {
          if (n.type === "text" && n.model) rows.push([n.model, n.options.hideLabel ? "" : n.name, !n.options.hidden]);
          Object.values(n).forEach(walk);
        }
      };
      walk(H.findModel(doc.list, "sc_info"));
      if (!rows.some((r) => r[0] === "sc_info_bom")) walk(H.findModel(doc.list, "sc_info_bom"));
      const on = {};
      rows.forEach((r) => (on[r[0]] = r[2]));
      w.trace.forEach((t) => {
        const k = String(t[0]).replace(/^sc:/, "");
        if (k === "display" || k === "hide") [].concat(t[1]).forEach((m) => m in on && (on[m] = k === "display"));
      });
      const val = (m) => (self.values[m] === undefined || self.values[m] === null ? "" : String(self.values[m]));
      return rows.filter((r) => on[r[0]]).map((r) => (r[1] ? r[1] + ": " : "") + val(r[0])).join("\n");
    },
  };
  return s;
};
// the lines the v36 explode builds for this header (a legacy IA as it is before any Small Cycle action)
const legacyLines = async (values, o) => {
  const s = session(values, o);
  await s.fire("onChange_assembledItem", { value: values.item_id, scLegacy: true });
  return s.v().stock_movement;
};
const picks = (row) => (row && row.temp_qty_data ? JSON.parse(row.temp_qty_data) : []);
const snapOf = (v) => {
  try {
    return v.bom_snapshot_json ? JSON.parse(v.bom_snapshot_json) : null;
  } catch (e) {
    return null;
  }
};

module.exports = { session, legacyLines, picks, snapOf, ON_DOC };
