# Fix plan: keep custom fields when an edit doesn't send them

**Status:** not built. The procurement custom fields this protects are on **dev only** (published 2026-10-16). Ship this
fix **with** the procurement custom-field release to prod, not after it.

## 1. The problem

Dev now saves custom fields on PO, GR and PI (header and line) and copies them PREQ → PO → GR → PI. Each save
workflow writes the custom-field column straight from the request payload.

**When the payload has no custom-field key, the update node writes NULL** and wipes what was stored. Verified on dev:
`CUSTOMER_SAVE` (same mapping style) ran an Edit without the key and the stored value went to NULL.

The web forms always send the key, so they're safe. These callers send edits without it (prod, last 400 runs of each
save workflow, 2026-10-16):

| Workflow | Edits without the key | Who | Lines carry `id`? |
|---|---|---|---|
| `GOODS_RECEIVING` | **11** | the mobile app (hand-built JSON, no `$_v`) | **No**, but every line has `po_line_item_id` |
| `PO_SAVE` | **1** | unidentified client, tenant 128671 (LSH, which uses custom fields) | Yes (`id` + `fm_key`) |
| `GR_CREATED`, `PI_SAVE`, `CUSTOMER_SAVE`, `SUPPLIER_SAVE` | 0 | (mobile/headless calls here are Adds only) | — |

Without a fix, a GR edited on mobile loses its header and line custom fields, and GR → PI then has nothing to copy.

## 2. Facts you need

**Columns**

| Document | Header | Line |
|---|---|---|
| PO | `custom_fields_b3w85tmv` | `custom_fields_va4w0xz3` (table_po) |
| GR | `custom_fields_e9609s2l` | `custom_fields_d7o7rdkd` (table_gr) |

**How the platform stores the object.** It translates keys both ways, using each table's own definitions
(`su_code_custom_field`):

- **Write** (add/update node, browser): field names → that table's definition ids. `PREQ_SAVE` was sent
  `{"cf_fillback_test":"by-name"}`; the row holds `{"2110930758643396609":"by-name"}`.
- **Read** through a search node, get node or form load: ids → field names again.
- A **sql-node returns the raw id-keyed JSON**. Never write a sql-read custom-field value back through an update node
  (untested round trip). Read stored values with a search or get node.

**The rule:** an **absent** key means "not sent", so keep the stored value. A **present** key, including `{}`, is the
user's value, so write it. Apply this to the header and to each line separately.

**Sample payloads (prod, read-only):**

- Mobile GR edit: run `2110941421979701250` (tenant 128671, 1 line) and `2108498681232756737` (073522, 37 lines).
  Params `allData`, `pageStatus: "Edit"`, `saveAs`, `continueZero`. The header has `id`. Lines have no `id` / `fm_key`
  and carry `po_line_item_id`, `line_index`, `parent_index`, `parent_or_child`, `is_split`.
- Headless PO edit: run `2110936091925286914` (128671). Param `allData`, `page_status: "Edit"`, lines with `id`.

## 3. Change 1: `GOODS_RECEIVING` (dev v102), the mobile case

No new read is needed. On Edit the workflow already reads the stored GR, header and `table_gr`, with a **search node**:
`search_origGRMain` inside `if_origReserved` (`pageStatus == Edit`). Its values come back by field name.

### 3a. New code node `code_node_CfKeep` ("Keep stored custom fields")

Place it at the top level, **directly after `code_node_origReserved`**. Declare both outputs in `response_json`:
`header` and `tableGr`.

```js
// The mobile app's GR edit sends no custom fields: keep the stored ones instead of writing NULL.
const HEAD = "custom_fields_e9609s2l";
const LINE = "custom_fields_d7o7rdkd";
const allData = {{node:code_node_4r2Fv9G5.data.allData}} || {};
const isEdit = {{workflowparams:pageStatus}} === "Edit";
const origRaw = {{node:search_origGRMain.data.data}};
const stored = Array.isArray(origRaw) ? origRaw[0] || null : origRaw || null;
const rows = Array.isArray(allData.table_gr) ? allData.table_gr : [];

if (!isEdit || !stored) {
  return { header: allData[HEAD], tableGr: rows };
}

const withChildren = (list) =>
  (list || []).flatMap((r) => [r, ...(Array.isArray(r.children) ? r.children : [])]);

// Stored line values per PO line, in their stored order (a split leaves several rows on one PO line).
const byPoLine = new Map();
for (const r of withChildren(stored.table_gr)) {
  const k = String(r.po_line_item_id || "");
  if (!k) continue;
  if (!byPoLine.has(k)) byPoLine.set(k, []);
  byPoLine.get(k).push(r[LINE]);
}

const used = new Map();
for (const r of withChildren(rows)) {
  if (LINE in r) continue;
  const k = String(r.po_line_item_id || "");
  const values = byPoLine.get(k);
  if (!values || values.length === 0) continue;
  const i = used.get(k) || 0;
  used.set(k, i + 1);
  r[LINE] = i < values.length ? values[i] : values[0];
}

return { header: HEAD in allData ? allData[HEAD] : stored[HEAD], tableGr: rows };
```

- **Lines are matched by `po_line_item_id`.** Mobile lines carry no `id`.
- **Splits:** one PO line can have several GR rows. They are matched in the order they appear. If the payload has
  more rows than were stored, the extra rows take the first stored row's value, which is normally identical because
  GR line values are copied from the PO line.
- A row that **carries** the key (web) is never touched.
- Add, or an Edit with no stored GR: payload passed through unchanged.
- `search_origGRMain` is referenced outside its IF. The linter reports this as CONDITIONAL (informational), and the
  value is null on Add, which the code handles.

### 3b. Point the writes at it

| Node | Prop | New value |
|---|---|---|
| `code_node_ApplyBatches` | line 2, `const tableGr = …` | `{{node:code_node_CfKeep.data.tableGr}} \|\| allData.table_gr \|\| []` |
| `update_node_a31whzYI` (Edit, !Draft) | `custom_fields_e9609s2l` | `{{node:code_node_CfKeep.data.header}}` |
| `add_node_nGMSu41b` (Add, !Draft) | `custom_fields_e9609s2l` | `{{node:code_node_CfKeep.data.header}}` |
| `update_node_bUR4vc0L` (Edit, Draft) | `custom_fields_e9609s2l` and `table_gr` | `…CfKeep.data.header` and `…CfKeep.data.tableGr` |
| `add_node_aSgBuQd7` (Add, Draft) | `custom_fields_e9609s2l` and `table_gr` | `…CfKeep.data.header` and `…CfKeep.data.tableGr` |

The !Draft pair already takes `table_gr` from `code_node_ApplyBatches`, which now starts from the restored rows. The
two putaway status updates (`update_node_ulMJS61J`, `update_node_AJkeXj0a`) write two columns only and are
unaffected.

## 4. Change 2: `PO_SAVE` (dev v43), the headless edit

`PO_SAVE` is **generated** by bladexfunctions-a6's builder: `scratchpad/grv2/phase1a/patch_po_save.py`, with
`code/fillback.js` and `sql_po_owned.sql`. Make the change there (or send a6 the diff against those files) so a rebuild
keeps it. Don't patch only the deployed JSON.

1. **`code_pre`**: add output `cfRestore` (declare it in `response_json`). Set it to `"YES"` when `page_status === "Edit"` and the header lacks
   `custom_fields_b3w85tmv` **or** any line (or bundle child) lacks `custom_fields_va4w0xz3`.
2. **New IF before `code_fillback`**: `'{{node:code_pre.data.cfRestore}}' == 'YES'`, with a **get node** `get_po_cf`
   in the true block (`purchase_order`, `id = allData.id`). A get node returns an **object** when the count is 1, so
   handle both shapes. Web saves send the keys and skip this read.
3. **`code_fillback`**, at the end, after `entry.table_po` is built:

```js
// A client that sends no custom fields keeps the stored ones (header, and each line by its id).
const cfRaw = {{node:get_po_cf.data.data}};
const cfStored = Array.isArray(cfRaw) ? cfRaw[0] || null : cfRaw || null;
if (cfStored) {
  if (!("custom_fields_b3w85tmv" in a)) entry.custom_fields_b3w85tmv = cfStored.custom_fields_b3w85tmv;
  const tree = (list) => (list || []).flatMap((l) => [l, ...(Array.isArray(l.children) ? l.children : [])]);
  const storedLine = new Map(tree(cfStored.table_po).map((l) => [String(l.id), l.custom_fields_va4w0xz3]));
  for (const l of tree(entry.table_po)) {
    if (!("custom_fields_va4w0xz3" in l) && storedLine.has(String(l.id))) {
      l.custom_fields_va4w0xz3 = storedLine.get(String(l.id));
    }
  }
}
```

Do **not** use `sql_po_owned` for this, because it returns raw id-keyed JSON. `add_po` / `update_po` already map
`custom_fields_b3w85tmv` from `code_fillback.data.entry`, so no node mapping changes.

## 5. Optional (no edits without the key seen)

Same guard, cheap to add if you want belt and braces: `GR_CREATED` (`GcPrep` copies header fields only when present,
so a key-less Edit writes NULL; mobile only Adds there today), `PI_SAVE`, `CUSTOMER_SAVE` / `SUPPLIER_SAVE`. Not
needed: `GR_COMPLETE_SUBMIT` (V2 is desktop-only; the gate passes the form's `allData`).

## 6. Tests

**Offline first** (no dev writes). Replay the changed code nodes with recorded prod runs using
`scratchpad/custom_fields/replay.js`. It resolves `{{node:…}}` placeholders from a run's `nodes_data`, runs the base and
patched script, and prints every output path that differs. Usage is in its header comment.

- Mobile GR edit (`2108498681232756737`, 37 lines) with stored values injected into `search_origGRMain`: header and
  every line keep the stored values.
- A web edit run: outputs identical to before the change.
- A web edit that sends `{}`: stays `{}`, so clearing still works.
- A split (two stored rows on one `po_line_item_id`): each row keeps its own value.

**Dev live** (tenant 000000 already has field `cf_fillback_test` on the PR and PO headers. Add the same field name on
GR header and GR / PO lines in APP Development → User Defined Field):

1. Make a GR in the web form with header and line values.
2. Run `GOODS_RECEIVING` with a mobile-shaped Edit payload (copy the structure of `2110941421979701250`: no line
   `id`, no custom-field keys) through the browser gateway (`scratchpad/gdc/tools/runwf.mjs`, not the CLI gateway).
3. Read the row: values unchanged. Compare **values**, not keys, because the raw column is keyed by definition id.
   `SELECT CAST(custom_fields_e9609s2l AS CHAR) FROM goods_receiving WHERE id = …`, and the same for
   `goods_receiving_eg6l4ywi_sub`.
4. Repeat for `PO_SAVE` with the headless payload shape (`2110936091925286914`).

## 7. Deploy

- **Dev:** `python3 scratchpad/validate.py` on each file (expect only the CONDITIONAL note), then
  `.dbtools/wf_upload.mjs` with your **own** plan file. Set `base` to the current enabled version, so a moved base
  refuses. Backups are taken automatically.
- **Coordinate with bladexfunctions-a6 first.** It owns the `GOODS_RECEIVING` repo copy and the `PO_SAVE` builder.
  Send the node diff before publishing; it re-seeds afterwards.
- **Prod:** paste with the procurement custom-field release (PO / GR / PI forms and the nine workflows). Before
  pasting, check that prod's `GOODS_RECEIVING` and `PO_SAVE` still match the bases you built on.

## Reference

| Item | Value |
|---|---|
| Dev versions this builds on | `GOODS_RECEIVING` v102 (id 2029090678383042562), `PO_SAVE` v43 (2069257894280118274) |
| Forms carrying the columns (dev) | PO v852, GR v1475, PI v625 |
| Test field definitions (dev, tenant 000000) | `cf_fillback_test` on PR header (2110930758643396609) and PO header (2110930999610355713) |
| Test data (dev, 000000) | PREQ D-PREQ-56 → Draft PO Draft-0089 (header value carried over) |
