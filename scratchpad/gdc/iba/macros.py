"""Text macros of INVENTORY_BULK_APPLY.ts.tpl: the SQL shared by the reads and the read-back, and the write loops."""
import json

QTY = ["unrestricted_qty", "reserved_qty", "block_qty", "qualityinsp_qty", "intransit_qty", "balance_quantity"]


def sql_lit(lines):
    return " +\n            ".join(json.dumps(l + ("\n" if i < len(lines) - 1 else "")) for i, l in enumerate(lines))


def outs(cols):
    return "{ " + ", ".join(f"{c}: {{ type: 'string', title: '{c}' }}" for c in cols) + " }"


BAL_COLS = ["id", "material_id", "location_id", "plant_id", "organization_id"] + QTY
BATCH_COLS = ["id", "material_id", "location_id", "batch_id", "plant_id", "organization_id"] + QTY + ["manufacturing_date", "expired_date", "remark", "remark2", "remark3"]
FIFO_COLS = ["id", "material_id", "plant_id", "organization_id", "batch_id", "fifo_sequence", "fifo_cost_price", "fifo_initial_quantity", "fifo_available_quantity"]
WA_COLS = ["id", "material_id", "plant_id", "organization_id", "batch_id", "wa_quantity", "wa_cost_price", "created_at"]

qty_select = ",\n".join(f"       CAST(b.{c} AS CHAR) AS {c}" for c in QTY)

MACROS = {
    "BAL_SQL": sql_lit(
        [
            "SELECT CAST(b.id AS CHAR) AS id, CAST(b.material_id AS CHAR) AS material_id, CAST(b.location_id AS CHAR) AS location_id,",
            "       CAST(b.plant_id AS CHAR) AS plant_id, b.organization_id,",
            *qty_select.split("\n"),
            "  FROM item_balance b",
            " WHERE b.tenant_id = ?",
            "   AND b.organization_id = ?",
            "   AND b.is_deleted = 0",
            "   AND (b.material_id, b.location_id, b.plant_id) IN (SELECT jt.m, jt.l, jt.p FROM JSON_TABLE(?, '$[*]' COLUMNS (m BIGINT PATH '$[0]', l BIGINT PATH '$[1]', p BIGINT PATH '$[2]')) jt)",
        ]
    ),
    "BAL_OUT": outs(BAL_COLS),
    "BATCH_SQL": sql_lit(
        [
            "SELECT CAST(b.id AS CHAR) AS id, CAST(b.material_id AS CHAR) AS material_id, CAST(b.location_id AS CHAR) AS location_id,",
            "       CAST(b.batch_id AS CHAR) AS batch_id, CAST(b.plant_id AS CHAR) AS plant_id, b.organization_id,",
            *(qty_select + ",").split("\n"),
            "       DATE_FORMAT(b.manufacturing_date, '%Y-%m-%d %H:%i:%s') AS manufacturing_date,",
            "       DATE_FORMAT(b.expired_date, '%Y-%m-%d %H:%i:%s') AS expired_date,",
            "       b.remark, b.remark2, b.remark3",
            "  FROM item_batch_balance b",
            " WHERE b.tenant_id = ?",
            "   AND b.organization_id = ?",
            "   AND b.is_deleted = 0",
            "   AND (b.material_id, b.location_id, b.batch_id, b.plant_id) IN (SELECT jt.m, jt.l, jt.b, jt.p FROM JSON_TABLE(?, '$[*]' COLUMNS (m BIGINT PATH '$[0]', l BIGINT PATH '$[1]', b BIGINT PATH '$[2]', p BIGINT PATH '$[3]')) jt)",
        ]
    ),
    "BATCH_OUT": outs(BATCH_COLS),
    "FIFO_SQL": sql_lit(
        [
            "SELECT CAST(f.id AS CHAR) AS id, CAST(f.material_id AS CHAR) AS material_id, CAST(f.plant_id AS CHAR) AS plant_id,",
            "       f.organization_id, CAST(COALESCE(f.batch_id, 0) AS CHAR) AS batch_id, f.fifo_sequence,",
            "       CAST(f.fifo_cost_price AS CHAR) AS fifo_cost_price, CAST(f.fifo_initial_quantity AS CHAR) AS fifo_initial_quantity,",
            "       CAST(f.fifo_available_quantity AS CHAR) AS fifo_available_quantity",
            "  FROM fifo_costing_history f",
            " WHERE f.tenant_id = ?",
            "   AND f.organization_id = ?",
            "   AND f.is_deleted = 0",
            "   AND (f.material_id, f.plant_id) IN (SELECT jt.m, jt.p FROM JSON_TABLE(?, '$[*]' COLUMNS (m BIGINT PATH '$[0]', p BIGINT PATH '$[1]')) jt)",
            " ORDER BY f.id",
        ]
    ),
    "FIFO_OUT": outs(FIFO_COLS),
    "WA_SQL": sql_lit(
        [
            "SELECT CAST(w.id AS CHAR) AS id, CAST(w.material_id AS CHAR) AS material_id, w.plant_id, w.organization_id,",
            "       CAST(COALESCE(w.batch_id, 0) AS CHAR) AS batch_id, CAST(w.wa_quantity AS CHAR) AS wa_quantity,",
            "       CAST(w.wa_cost_price AS CHAR) AS wa_cost_price, w.created_at",
            "  FROM wa_costing_method w",
            " WHERE w.tenant_id = ?",
            "   AND w.organization_id = ?",
            "   AND w.is_deleted = 0",
            "   AND (w.material_id, w.plant_id) IN (SELECT jt.m, jt.p FROM JSON_TABLE(?, '$[*]' COLUMNS (m BIGINT PATH '$[0]', p BIGINT PATH '$[1]')) jt)",
            " ORDER BY w.id",
        ]
    ),
    "WA_OUT": outs(WA_COLS),
    "MV_SQL": sql_lit(
        [
            "SELECT m.operation_effect_key",
            "  FROM inventory_movement m",
            " WHERE m.tenant_id = ?",
            "   AND m.operation_effect_key IN (SELECT jt.k FROM JSON_TABLE(?, '$[*]' COLUMNS (k VARCHAR(255) CHARSET utf8mb4 COLLATE utf8mb4_general_ci PATH '$')) jt)",
            "   AND m.is_deleted = 0",
        ]
    ),
    "MV_OUT": outs(["operation_effect_key"]),
}

UPD = "update"
ADD = "add"
LOOPS = [
    ("ib", "Item_Balance", UPD, ["id"] + QTY, "item_balance: the six quantities"),
    ("bb", "Item_Batch_Balance", UPD, ["id"] + QTY, "item_batch_balance: the six quantities"),
    ("bbr", "Item_Batch_Balance", UPD, ["id"] + QTY + ["remark", "remark2", "remark3"], "item_batch_balance: quantities + remarks (ADD)"),
    ("ff", "FIFO_Costing_History", UPD, ["id", "fifo_available_quantity"], "FIFO layers: fifo_available_quantity"),
    ("wa", "Weighted_Average_Costing_History", UPD, ["id", "wa_quantity", "wa_cost_price"], "Weighted Average rows"),
    ("ibNew", "Item_Balance", ADD, ["material_id", "material_uom", "location_id", "block_qty", "reserved_qty", "unrestricted_qty", "qualityinsp_qty", "intransit_qty", "balance_quantity", "plant_id", "organization_id"], "new item_balance rows"),
    ("bbNew", "Item_Batch_Balance", ADD, ["material_id", "material_uom", "location_id", "block_qty", "reserved_qty", "unrestricted_qty", "qualityinsp_qty", "intransit_qty", "balance_quantity", "batch_id", "plant_id", "organization_id", "doc_date", "manufacturing_date", "expired_date", "remark", "remark2", "remark3"], "new item_batch_balance rows"),
    ("ffNew", "FIFO_Costing_History", ADD, ["fifo_cost_price", "fifo_initial_quantity", "fifo_available_quantity", "material_id", "batch_id", "fifo_sequence", "plant_id", "organization_id"], "new FIFO layers"),
    ("waNew", "Weighted_Average_Costing_History", ADD, ["wa_cost_price", "wa_quantity", "material_id", "batch_id", "plant_id", "organization_id"], "new Weighted Average rows"),
    ("mv", "Inventory_Movement", ADD, ["operation_effect_key", "transaction_type", "trx_no", "inventory_category", "parent_trx_no", "movement", "plant_id", "organization_id", "unit_price", "total_price", "quantity", "base_qty", "uom_id", "base_uom_id", "item_id", "bin_location_id", "batch_number_id", "costing_method_id", "manufacturing_date", "expired_date", "doc_date", "actual_qty", "actual_base_qty", "handling_unit_id"], "inventory_movement, one row per movement, keyed operation_effect_key"),
]


def write_loops(indent="        "):
    out = []
    for key, table, kind, cols, title in LOOPS:
        K = key[0].upper() + key[1:]
        sl = f"code_node_IBw{K}S"
        idx = f"get_cache_IBw{K}"
        props = ",\n".join(f"{indent}        {c}: {sl}.rows.{c}" for c in cols)
        if kind == UPD:
            write = (
                f"{indent}    const update_node_IBw{K} = await update('WRITE {title} (<= 250 per call)', {{\n"
                f"{indent}      props: {{\n{props},\n{indent}      }},\n"
                f"{indent}      table: t.{table},\n"
                f"{indent}      where: {{ field: 'id', op: 'in', value: {sl}.rows.id, valueType: 'field' }},\n"
                f"{indent}    }});\n"
            )
        else:
            write = (
                f"{indent}    /* @id add_node_IBw{K} */ await add('WRITE {title} (<= 250 per call)', {{\n"
                f"{indent}      props: {{\n{props},\n{indent}      }},\n"
                f"{indent}      table: t.{table},\n"
                f"{indent}    }});\n"
            )
        out.append(
            f"{indent}const set_cache_IBw{K}0 = await setCache(\"{key} slice index = 0 (per run: the key carries the run's nonce)\", {{\n"
            f"{indent}  key: 'iba_{key}_{{{{node:code_node_IBguard.data.nonce}}}}',\n"
            f"{indent}  value: '0',\n"
            f"{indent}  ttl: 3600000,\n"
            f"{indent}}});\n"
            f"{indent}/* @id loop_IBw{K} @title \"Write {key} in slices of <= 250\" */ for (const _item of code_node_IBplan.{key}Slices) {{\n"
            f"{indent}  const {idx} = await getCache('{key} slice index', {{ key: 'iba_{key}_{{{{node:code_node_IBguard.data.nonce}}}}' }});\n"
            f"{indent}  const {sl} = await code('{key} slice', CODE('slice.tpl.js', {{'__LIST__': '{key}', '__SRC__': 'code_node_IBplan', '__IDX__': '{idx}'}}), {{\n"
            f"{indent}    outputs: {{\n"
            f"{indent}      rows: {{ type: 'array', title: 'rows', items: 'any' }},\n"
            f"{indent}      count: {{ type: 'string', title: 'count' }},\n"
            f"{indent}      nextIndex: {{ type: 'string', title: 'nextIndex' }},\n"
            f"{indent}    }},\n"
            f"{indent}  }});\n"
            + write.replace(f"{indent}    ", f"{indent}  ", 1)
            + f"{indent}  const set_cache_IBw{K}N = await setCache('Next {key} slice index', {{\n"
            f"{indent}    key: 'iba_{key}_{{{{node:code_node_IBguard.data.nonce}}}}',\n"
            f"{indent}    value: {sl}.nextIndex,\n"
            f"{indent}    ttl: 3600000,\n"
            f"{indent}  }});\n"
            f"{indent}}}\n"
        )
    return "".join(out)


MACROS["WRITE_LOOPS"] = write_loops()
MACROS["CODE_OF_PLAN"] = "code_node_IBplan.code"
