"""GR Revert Completed V2 reads: PREPARE (SQL, two rounds) and SUBMIT (SUBMIT_SQL). One JSON_OBJECT per row (`j`; the
multi-kind reads also `k`), no row limits, each round run in parallel (condition-all-node). Node ids: sql_node_VP<key>
(PREPARE), sql_node_VS<key> (SUBMIT).

Interpolated values (digits only, every one checked fail-closed in the node that outputs it):
  round 1 + SUBMIT: tenantId (quoted: tenant_id is varchar) and grId (bare against bigint ids, quoted against the varchar
          columns that hold it: transfer_order_putaway.gr_no, basic_inspection_lot.goods_receiving_no, in_transit_detail.doc_id,
          gd_publish_step.job_id) from code_node_VPentry / code_node_VSentry. The receipt's organization, number and plant
          are never interpolated: every read joins the stored goods_receiving row (tenant + id) and takes them from it.
  round 2: code_node_VPprep's sql* values (sqlMinLiveId, sqlPlantId: one id; sqlItemIds, sqlBatchIds, sqlHuIds, sqlPoIds,
          sqlPoLineIds: comma-separated ids, "0" when empty).

Shapes (code/prepare/adapter.js turns them into what the classic's nodes handed on):
- hdr: every column of goods_receiving its schema defines (lift/fields.json), formatted as the get-node answers them.
- lines: the columns of goods_receiving_eg6l4ywi_sub that grRvPrep / grRvBuild / the plan read (LINE), formatted the same
  way, + `sn` (the line item's serial_number_management: serial receipts are not V2's). Not every column: 2,000 full lines
  would be ~3.5 MB in each of the five places the lines travel (node-data budget); the bodies read no other column.
- movs / later / fifo / wa / costcounts: the classic's sql-nodes (sql_node_grRvMovs / Later / Fifo / Wa / CostCounts) - the
  same filters (organization, no tenant filter, as there), the same select lists, ids and decimals CAST AS CHAR as the
  platform hands them on; FIFO / WA / movements in id order.
- putaway / qi / transit / batches / pi / bbal / ibal / hu / po / oo / items: the classic's search-nodes (search_node_grRv*),
  the same filters + the session tenant, no limit; only the columns the lifted bodies, the plan and COMMIT's checks read; ids
  as digit strings, decimals as numbers; nested subforms as `k` rows. Id order (the platform's search order is its access
  path's - recorded runs show id order and index order - and grRvBuild depends on it only for which of two duplicate
  balance rows it reads, which INVENTORY_BULK_APPLY refuses anyway).
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
COLS = json.load(open(os.path.join(HERE, "..", "lift", "fields.json")))

E = "code_node_VPentry"
PP = "code_node_VPprep"
SUBMIT_ENTRY = "code_node_VSentry"
GRL = "goods_receiving_eg6l4ywi_sub"


def jobj(alias, table, only=None):
    parts = []
    for c, k in COLS[table].items():
        if only is not None and c not in only:
            continue
        col = f"{alias}.`{c}`"
        if k == "dt":
            e = f"DATE_FORMAT({col}, '%Y-%m-%d %H:%i:%s')"
        elif k == "dt3":
            e = f"SUBSTRING(DATE_FORMAT({col}, '%Y-%m-%d %H:%i:%s.%f'), 1, 23)"
        elif k == "date":
            e = f"DATE_FORMAT({col}, '%Y-%m-%d')"
        else:
            e = col
        parts.append(f"'{c}', {e}")
    if table == "goods_receiving" and only is None and "gr_v2_job_id" not in COLS[table]:
        # the hidden lock column of GR V2 (varchar); written as `g.gr_v2_job_id` so sqlcheck can stand in for it until it exists
        parts.append("'gr_v2_job_id', CAST(g.gr_v2_job_id AS CHAR)")
    return "JSON_OBJECT(" + ", ".join(parts) + ")"


def jcols(alias, spec):
    """spec: [(column, how)] - how: 'id' / 'chr' -> CAST AS CHAR, 'raw' -> as is, 'dt3' -> formatted"""
    parts = []
    for c, how in spec:
        col = f"{alias}.`{c}`"
        if how in ("id", "chr"):
            e = f"CAST({col} AS CHAR)"
        elif how == "dt3":
            e = f"SUBSTRING(DATE_FORMAT({col}, '%Y-%m-%d %H:%i:%s.%f'), 1, 23)"
        else:
            e = col
        parts.append(f"'{c}', {e}")
    return "JSON_OBJECT(" + ", ".join(parts) + ")"


# sql_node_grRvMovs's select list (ids and decimals CAST AS CHAR: the platform hands sql-node decimals on as text)
MOV = [("id", "id"), ("transaction_type", "raw"), ("movement", "raw"), ("trx_no", "raw"), ("parent_trx_no", "raw"), ("item_id", "id"),
       ("plant_id", "id"), ("bin_location_id", "id"), ("batch_number_id", "id"), ("handling_unit_id", "id"), ("inventory_category", "raw"),
       ("quantity", "chr"), ("base_qty", "chr"), ("uom_id", "id"), ("base_uom_id", "id"), ("unit_price", "chr"), ("costing_method_id", "raw")]
FIFO = [("id", "id"), ("material_id", "id"), ("batch_id", "id"), ("fifo_cost_price", "chr"), ("fifo_initial_quantity", "chr"),
        ("fifo_available_quantity", "chr"), ("fifo_sequence", "raw")]
WA = [("id", "id"), ("material_id", "id"), ("batch_id", "id"), ("wa_quantity", "chr"), ("wa_cost_price", "chr")]
# the line columns grRvPrep / grRvBuild / the plan read (+ line_index, item_name for a reader)
LINE = ["id", "goods_receiving_id", "parent_id", "line_index", "item_id", "item_name", "item_bundle_id", "received_qty", "base_received_qty",
        "po_line_item_id", "line_po_id", "is_split", "parent_or_child", "parent_index", "return_quantity", "created_return_qty"]
# search-node reads: the columns grRvBuild reads (+ what the plan and COMMIT's re-checks compare)
TO = [("id", "id"), ("to_id", "raw"), ("to_status", "raw"), ("is_processing", "raw"), ("qi_id", "raw"), ("gr_no", "raw"), ("organization_id", "raw")]
TOL = [("id", "id"), ("transfer_order_putaway_id", "id"), ("parent_id", "id"), ("line_status", "raw"), ("putaway_qty", "raw")]
TOR = [("id", "id"), ("transfer_order_putaway_id", "id"), ("parent_id", "id")]
QI = [("id", "id"), ("inspection_lot_no", "raw"), ("receiving_insp_status", "raw")]
IT = [("id", "id"), ("material_id", "id"), ("status", "raw"), ("transit_qty", "raw"), ("open_qty", "raw")]
BATCH = [("id", "id"), ("batch_number", "raw"), ("material_id", "id"), ("transaction_no", "raw"), ("parent_transaction_no", "raw")]
PI = [("id", "id"), ("purchase_invoice_no", "raw"), ("pi_status", "raw")]
QTY = [("unrestricted_qty", "raw"), ("reserved_qty", "raw"), ("block_qty", "raw"), ("qualityinsp_qty", "raw"), ("intransit_qty", "raw")]
IBAL = [("id", "id"), ("material_id", "id"), ("location_id", "id"), ("plant_id", "id")] + QTY
BBAL = [("id", "id"), ("material_id", "id"), ("location_id", "id"), ("batch_id", "id"), ("plant_id", "id")] + QTY
HU = [("id", "id"), ("handling_no", "raw"), ("hu_status", "raw"), ("parent_hu_id", "raw"), ("packing_id", "raw"), ("plant_id", "id"),
      ("storage_location_id", "id"), ("location_id", "id")]
HUI = [("id", "id"), ("handling_unit_id", "id"), ("material_id", "id"), ("batch_id", "id"), ("quantity", "raw"), ("balance_id", "raw")]
POH = [("id", "id"), ("purchase_order_no", "raw"), ("po_status", "raw")]
POL = [("id", "id"), ("purchase_order_id", "id"), ("parent_id", "id"), ("item_bundle_id", "id"), ("item_id", "raw"), ("quantity", "raw"),
       ("received_qty", "raw"), ("created_received_qty", "raw"), ("line_status", "raw")]
OO = [("id", "id"), ("po_line_id", "id"), ("scheduled_qty", "raw"), ("received_qty", "raw")]
ITEM = [("id", "id"), ("material_code", "raw"), ("material_name", "raw"), ("based_uom", "id"), ("material_costing_method", "raw"),
        ("stock_control", "raw"), ("serial_number_management", "raw")]
UOM = [("id", "id"), ("Item_id", "id"), ("alt_uom_id", "id"), ("base_qty", "raw")]


def reads(entry):
    """round 1 (PREPARE) / SUBMIT: the receipt, its lines, its movements - and for PREPARE its documents and lock"""
    T = "'{{node:%s.data.tenantId}}'" % entry
    G = "{{node:%s.data.grId}}" % entry
    GR = f"goods_receiving g\n WHERE g.tenant_id = {T} AND g.id = {G} AND g.is_deleted = 0"
    out = {
        # get_node_grRvGr: the receipt (its lines come from `lines`, nested by the adapter)
        "hdr": f"SELECT {jobj('g', 'goods_receiving')} AS j\n  FROM {GR}",
        # + the line item's serial flag (sn): serial receipts stay with the classic revert (the engine has no serial handling)
        "lines": (
            f"SELECT {jobj('l', GRL, LINE)} AS j,\n"
            "       (SELECT i.serial_number_management FROM item i WHERE i.id = l.item_id AND i.tenant_id = l.tenant_id AND i.is_deleted = 0 LIMIT 1) AS sn\n"
            f"  FROM {GRL} l\n WHERE l.tenant_id = {T} AND l.goods_receiving_id = {G} AND l.is_deleted = 0\n ORDER BY l.id"
        ),
        # sql_node_grRvMovs: everything after the receipt that names it (its GRN / GRN-R rows, its putaway's TO - PA, HU / HU-R)
        "movs": (
            f"SELECT {jcols('m', MOV)} AS j\n  FROM goods_receiving g\n  JOIN inventory_movement m\n"
            "    ON m.id > g.id AND m.organization_id = g.organization_id AND m.is_deleted = 0\n"
            "   AND (m.trx_no = g.gr_no OR COALESCE(m.parent_trx_no, '') = g.gr_no)\n"
            f" WHERE g.tenant_id = {T} AND g.id = {G} AND g.is_deleted = 0\n ORDER BY m.id"
        ),
    }
    if entry != E:
        return out
    org = "g.organization_id"
    out.update({
        # search_node_grRvPutaway: the receipt's putaways (gr_no = the receipt id), each with its lines and records
        "putaway": (
            "SELECT x.k, x.j FROM (\n"
            f"SELECT 'TO' AS k, p.id AS sid, {jcols('p', TO)} AS j\n"
            "  FROM goods_receiving g\n  JOIN transfer_order_putaway p\n"
            f"    ON p.tenant_id = g.tenant_id AND p.gr_no = '{G}' AND p.organization_id = {org} AND p.is_deleted = 0\n"
            f" WHERE g.tenant_id = {T} AND g.id = {G} AND g.is_deleted = 0\n"
            "UNION ALL\n"
            f"SELECT 'TOL' AS k, l.id AS sid, {jcols('l', TOL)} AS j\n"
            "  FROM goods_receiving g\n  JOIN transfer_order_putaway p\n"
            f"    ON p.tenant_id = g.tenant_id AND p.gr_no = '{G}' AND p.organization_id = {org} AND p.is_deleted = 0\n"
            "  JOIN transfer_order_putaway_jz8m9w3h_sub l ON l.transfer_order_putaway_id = p.id AND l.is_deleted = 0\n"
            f" WHERE g.tenant_id = {T} AND g.id = {G} AND g.is_deleted = 0\n"
            "UNION ALL\n"
            f"SELECT 'TOR' AS k, r.id AS sid, {jcols('r', TOR)} AS j\n"
            "  FROM goods_receiving g\n  JOIN transfer_order_putaway p\n"
            f"    ON p.tenant_id = g.tenant_id AND p.gr_no = '{G}' AND p.organization_id = {org} AND p.is_deleted = 0\n"
            "  JOIN transfer_order_putaway_vrqs3cmr_sub r ON r.transfer_order_putaway_id = p.id AND r.is_deleted = 0\n"
            f" WHERE g.tenant_id = {T} AND g.id = {G} AND g.is_deleted = 0\n"
            ") x ORDER BY x.k, x.sid"
        ),
        # search_node_grRvQi: inspection lots of the receipt (goods_receiving_no = the receipt id)
        "qi": (
            f"SELECT {jcols('b', QI)} AS j\n  FROM goods_receiving g\n  JOIN basic_inspection_lot b\n"
            f"    ON b.tenant_id = g.tenant_id AND b.goods_receiving_no = '{G}' AND b.organization_id = {org} AND b.is_deleted = 0\n"
            f" WHERE g.tenant_id = {T} AND g.id = {G} AND g.is_deleted = 0\n ORDER BY b.id"
        ),
        # search_node_grRvTransit: the receipt's in-transit rows, every status
        "transit": (
            f"SELECT {jcols('t', IT)} AS j\n  FROM goods_receiving g\n  JOIN in_transit_detail t\n"
            f"    ON t.tenant_id = g.tenant_id AND t.doc_id = '{G}' AND t.doc_type = 'Goods Receiving' AND t.organization_id = {org} AND t.is_deleted = 0\n"
            f" WHERE g.tenant_id = {T} AND g.id = {G} AND g.is_deleted = 0\n ORDER BY t.id"
        ),
        # search_node_grRvBatch: batches whose transaction_no is the receipt number
        "batches": (
            f"SELECT {jcols('b', BATCH)} AS j\n  FROM goods_receiving g\n  JOIN batch b\n"
            f"    ON b.tenant_id = g.tenant_id AND b.transaction_no = g.gr_no AND b.organization_id = {org} AND b.is_deleted = 0\n"
            f" WHERE g.tenant_id = {T} AND g.id = {G} AND g.is_deleted = 0\n ORDER BY b.id"
        ),
        # the receipt's latest lock (GR_REVERT_SUBMIT / GR_COMPLETE_SUBMIT): result_ref = the owning job's idempotency_key
        "lock": (
            "SELECT p.step_name, p.result_ref\n  FROM gd_publish_step p\n"
            f" WHERE p.tenant_id = {T} AND p.job_id = CONCAT('GRC|', '{G}') AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0\n"
            " ORDER BY p.id DESC\n LIMIT 1"
        ),
    })
    return out


def round2():
    """round 2 (PREPARE): grRvPrep's id lists, from code_node_VPprep"""
    T = "'{{node:%s.data.tenantId}}'" % E
    G = "{{node:%s.data.grId}}" % E
    V = lambda k: "{{node:%s.data.%s}}" % (PP, k)  # noqa: E731
    GRW = f"g.tenant_id = {T} AND g.id = {G} AND g.is_deleted = 0"
    org = "g.organization_id"
    items, plant = V("sqlItemIds"), V("sqlPlantId")
    return {
        # sql_node_grRvLater: per item / batch of the receipt, the newest movement since its oldest live row that is not its own chain
        "later": (
            "SELECT JSON_OBJECT('item_id', CAST(m.item_id AS CHAR), 'batch_id', CAST(m.batch_number_id AS CHAR), 'max_id', CAST(MAX(m.id) AS CHAR),\n"
            "         'latest', SUBSTRING_INDEX(GROUP_CONCAT(CONCAT(m.transaction_type, ' ', COALESCE(m.trx_no, '')) ORDER BY m.id DESC SEPARATOR '|'), '|', 1)) AS j\n"
            f"  FROM goods_receiving g\n  JOIN inventory_movement m ON m.organization_id = {org} AND m.is_deleted = 0\n"
            f" WHERE {GRW}\n"
            f"   AND m.id > {V('sqlMinLiveId')}\n   AND m.plant_id = {plant}\n   AND m.item_id IN ({items})\n"
            "   AND NOT (m.transaction_type IN ('GRN', 'GRN-R') AND m.trx_no = g.gr_no)\n"
            "   AND NOT (m.transaction_type IN ('HU', 'HU-R') AND COALESCE(m.parent_trx_no, '') = g.gr_no)\n"
            "   AND NOT (m.transaction_type = 'TO - PA' AND COALESCE(m.parent_trx_no, '') = g.gr_no)\n"
            " GROUP BY m.item_id, m.batch_number_id\n ORDER BY m.item_id, m.batch_number_id"
        ),
        # sql_node_grRvFifo: live FIFO layers newer than the receipt document
        "fifo": (
            f"SELECT {jcols('f', FIFO)} AS j\n  FROM goods_receiving g\n  JOIN fifo_costing_history f ON f.organization_id = {org} AND f.is_deleted = 0\n"
            f" WHERE {GRW}\n   AND f.id > g.id AND f.plant_id = {plant} AND f.material_id IN ({items})\n ORDER BY f.id"
        ),
        # sql_node_grRvWa: the running (non-batch) average rows and batch rows newer than the receipt (plant_id is varchar there)
        "wa": (
            f"SELECT {jcols('w', WA)} AS j\n  FROM goods_receiving g\n  JOIN wa_costing_method w ON w.organization_id = {org} AND w.is_deleted = 0\n"
            f" WHERE {GRW}\n   AND w.plant_id = '{plant}' AND w.material_id IN ({items})\n"
            "   AND (w.batch_id IS NULL OR w.id > g.id)\n ORDER BY w.id"
        ),
        # sql_node_grRvCostCounts: live FIFO / WA rows per item of the plant
        "costcounts": (
            "SELECT JSON_OBJECT('t', x.t, 'material_id', x.material_id, 'cnt', x.cnt) AS j FROM (\n"
            "SELECT 'FIFO' AS t, CAST(f.material_id AS CHAR) AS material_id, COUNT(*) AS cnt\n"
            f"  FROM goods_receiving g\n  JOIN fifo_costing_history f ON f.organization_id = {org} AND f.is_deleted = 0\n"
            f" WHERE {GRW}\n   AND f.plant_id = {plant} AND f.material_id IN ({items})\n GROUP BY f.material_id\n"
            "UNION ALL\n"
            "SELECT 'WA' AS t, CAST(w.material_id AS CHAR) AS material_id, COUNT(*) AS cnt\n"
            f"  FROM goods_receiving g\n  JOIN wa_costing_method w ON w.organization_id = {org} AND w.is_deleted = 0\n"
            f" WHERE {GRW}\n   AND w.plant_id = '{plant}' AND w.material_id IN ({items})\n GROUP BY w.material_id\n"
            ") x ORDER BY x.t, x.material_id"
        ),
        # search_node_grRvPi: invoices naming the receipt in gr_id (a JSON array of ids; text, numbers matched too)
        "pi": (
            f"SELECT {jcols('p', PI)} AS j\n  FROM goods_receiving g\n  JOIN purchase_invoice p\n"
            f"    ON p.tenant_id = g.tenant_id AND p.organization_id = {org} AND p.is_deleted = 0\n"
            f"   AND (JSON_CONTAINS(p.gr_id, JSON_QUOTE('{G}')) OR JSON_CONTAINS(p.gr_id, '{G}'))\n"
            f" WHERE {GRW}\n ORDER BY p.id"
        ),
        # search_node_grRvBatchBal / ItemBal: balances of the live batches / the receipt's items at the plant
        "bbal": (
            f"SELECT {jcols('b', BBAL)} AS j\n  FROM goods_receiving g\n  JOIN item_batch_balance b\n"
            f"    ON b.tenant_id = g.tenant_id AND b.organization_id = {org} AND b.is_deleted = 0\n"
            f" WHERE {GRW}\n   AND b.batch_id IN ({V('sqlBatchIds')}) AND b.plant_id = {plant}\n ORDER BY b.id"
        ),
        "ibal": (
            f"SELECT {jcols('b', IBAL)} AS j\n  FROM goods_receiving g\n  JOIN item_balance b\n"
            f"    ON b.tenant_id = g.tenant_id AND b.organization_id = {org} AND b.is_deleted = 0\n"
            f" WHERE {GRW}\n   AND b.material_id IN ({items}) AND b.plant_id = {plant}\n ORDER BY b.id"
        ),
        # search_node_grRvHu: the live rows' handling units with their items (table_hu_items)
        "hu": (
            "SELECT x.k, x.j FROM (\n"
            f"SELECT 'HU' AS k, h.id AS sid, {jcols('h', HU)} AS j\n"
            f"  FROM goods_receiving g\n  JOIN handling_unit h ON h.tenant_id = g.tenant_id AND h.organization_id = {org} AND h.is_deleted = 0\n"
            f" WHERE {GRW}\n   AND h.id IN ({V('sqlHuIds')})\n"
            "UNION ALL\n"
            f"SELECT 'HUI' AS k, i.id AS sid, {jcols('i', HUI)} AS j\n"
            f"  FROM goods_receiving g\n  JOIN handling_unit h ON h.tenant_id = g.tenant_id AND h.organization_id = {org} AND h.is_deleted = 0\n"
            "  JOIN handling_unit_atu7sreg_sub i ON i.handling_unit_id = h.id AND i.is_deleted = 0\n"
            f" WHERE {GRW}\n   AND h.id IN ({V('sqlHuIds')})\n"
            ") x ORDER BY x.k, x.sid"
        ),
        # search_node_grRvPo: the purchase orders (no organization filter, as there) with their lines (table_po, a tree)
        "po": (
            "SELECT x.k, x.j FROM (\n"
            f"SELECT 'PO' AS k, p.id AS sid, {jcols('p', POH)} AS j\n"
            f"  FROM purchase_order p\n WHERE p.tenant_id = {T} AND p.is_deleted = 0 AND p.id IN ({V('sqlPoIds')})\n"
            "UNION ALL\n"
            f"SELECT 'POL' AS k, pl.id AS sid, {jcols('pl', POL)} AS j\n"
            "  FROM purchase_order p\n  JOIN purchase_order_2ukyuanr_sub pl ON pl.purchase_order_id = p.id AND pl.is_deleted = 0\n"
            f" WHERE p.tenant_id = {T} AND p.is_deleted = 0 AND p.id IN ({V('sqlPoIds')})\n"
            ") x ORDER BY x.k, x.sid"
        ),
        # search_node_grRvOnOrder: on-order rows of the receipt's PO lines
        "oo": (
            f"SELECT {jcols('o', OO)} AS j\n  FROM goods_receiving g\n  JOIN on_order_purchase_order o\n"
            f"    ON o.tenant_id = g.tenant_id AND o.organization_id = {org} AND o.is_deleted = 0\n"
            f" WHERE {GRW}\n   AND o.po_line_id IN ({V('sqlPoLineIds')})\n ORDER BY o.id"
        ),
        # search_node_grRvItems: the items (no organization filter, as there) with their UOM conversions (table_uom_conversion)
        "items": (
            "SELECT x.k, x.j FROM (\n"
            f"SELECT 'I' AS k, i.id AS sid, {jcols('i', ITEM)} AS j\n"
            f"  FROM item i\n WHERE i.tenant_id = {T} AND i.is_deleted = 0 AND i.id IN ({items})\n"
            "UNION ALL\n"
            f"SELECT 'U' AS k, u.id AS sid, {jcols('u', UOM)} AS j\n"
            "  FROM item i\n  JOIN item_mji552rc_sub u ON u.Item_id = i.id AND u.is_deleted = 0\n"
            f" WHERE i.tenant_id = {T} AND i.is_deleted = 0 AND i.id IN ({items})\n"
            ") x ORDER BY x.k, x.sid"
        ),
    }


ROUND1 = reads(E)
ROUND2 = round2()
SQL = dict(ROUND1, **ROUND2)
SUBMIT_SQL = reads(SUBMIT_ENTRY)
KJ = ("putaway", "hu", "po", "items")
COLUMNS = {k: (["k", "j"] if k in KJ else ["j"]) for k in SQL}
COLUMNS["lock"] = ["step_name", "result_ref"]
COLUMNS["lines"] = ["j", "sn"]
SUBMIT_COLUMNS = {k: ["j"] for k in SUBMIT_SQL}
SUBMIT_COLUMNS["lines"] = ["j", "sn"]
TITLES = {
    "hdr": "The receipt (every schema field + gr_v2_job_id)", "lines": "Its lines (table_gr)", "movs": "Its stock movements (sql_node_grRvMovs)",
    "putaway": "Its putaways + lines + records", "qi": "Its inspection lots", "transit": "Its in-transit rows (every status)",
    "batches": "Batches minted under its number", "lock": "Its latest lock (GRC|<gr>)",
    "later": "Later movements on its stock (sql_node_grRvLater)", "fifo": "FIFO layers newer than it", "wa": "Weighted average rows",
    "costcounts": "Costing rows per item", "pi": "Purchase invoices naming it", "bbal": "Batch balances of its live batches",
    "ibal": "Item balances of its items", "hu": "Handling units of its live rows", "po": "Its purchase orders + lines",
    "oo": "On-order rows of its PO lines", "items": "Item masters + UOM conversions",
}
# the entry fields each statement set interpolates
ENTRY_FIELDS = {"PREPARE_1": (E, ["tenantId", "grId"]),
                "PREPARE_2": (PP, ["sqlMinLiveId", "sqlPlantId", "sqlItemIds", "sqlBatchIds", "sqlHuIds", "sqlPoIds", "sqlPoLineIds"]),
                "SUBMIT": (SUBMIT_ENTRY, ["tenantId", "grId"])}

# the columns each read returns, by row kind (test/synthetic_2k.js builds its rows with these and no others)
SHAPES = {"lines": LINE, "movs": [c for c, _ in MOV], "fifo": [c for c, _ in FIFO], "wa": [c for c, _ in WA], "TO": [c for c, _ in TO], "TOL": [c for c, _ in TOL],
          "TOR": [c for c, _ in TOR], "qi": [c for c, _ in QI], "transit": [c for c, _ in IT], "batches": [c for c, _ in BATCH], "pi": [c for c, _ in PI],
          "ibal": [c for c, _ in IBAL], "bbal": [c for c, _ in BBAL], "HU": [c for c, _ in HU], "HUI": [c for c, _ in HUI], "PO": [c for c, _ in POH],
          "POL": [c for c, _ in POL], "oo": [c for c, _ in OO], "I": [c for c, _ in ITEM], "U": [c for c, _ in UOM]}

if __name__ == "__main__":
    import sys
    if "--shapes" in sys.argv:
        print(json.dumps(SHAPES))
        sys.exit(0)
    for name, d in (("PREPARE round 1", ROUND1), ("PREPARE round 2", ROUND2), ("SUBMIT", SUBMIT_SQL)):
        for k, v in d.items():
            print(f"-- {name}[{k}]: {len(v)} chars")
