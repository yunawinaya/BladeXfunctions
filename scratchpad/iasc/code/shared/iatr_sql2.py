"""IA transfer requests from a reserved IA (scratchpad/iatr/RESERVED_REQUEST_PLAN.md Task 8): the Item Assembly guard's read, one scalar
subquery for IA_SAVE v16 (sql_node_IAguard) and IA_V2_SUBMIT v8 (sql_node_ISfacts). Tokens: @T tenant, @IA the IA's id (both digits;
quoted, as source_ia_id is varchar), @ITEMS the save's item ids (digits, comma-joined; "0" = none: IA_V2_SUBMIT reads its items itself),
@GATE a condition ANDed first (IA_V2_SUBMIT's constant gate; IA_SAVE wraps the subquery in IF instead). Value: JSON text {reqs: every
supply request of the IA - id, no, status, bin (its first line's location_id), bin_name - and items: the items' stock / serial flags}; an
empty list is null. The LOT line table has only its PRIMARY key: each request's lines are scanned once (LATERAL) for its first line, read
by id with its bin."""

REQUESTS = """(SELECT CAST(JSON_OBJECT(
             'reqs', (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', CAST(rq.id AS CHAR), 'no', rq.stock_movement_no, 'status', rq.stock_movement_status,
                              'bin', CAST(rd.location_id AS CHAR), 'bin_name', rb.bin_location_combine))
                        FROM sm_location_transfer rq
                       CROSS JOIN LATERAL (SELECT MIN(rl.id) AS first_id FROM sm_location_transfer_d2c7o1jd_sub rl
                                            WHERE rl.tenant_id = '@T' AND rl.sm_location_transfer_id = rq.id AND rl.is_deleted = 0) rx
                        LEFT JOIN sm_location_transfer_d2c7o1jd_sub rd ON rd.id = rx.first_id
                        LEFT JOIN bin_location rb ON rb.id = rd.location_id
                       WHERE @GATErq.tenant_id = '@T' AND rq.is_deleted = 0 AND rq.transfer_purpose = 'IA_SUPPLY' AND rq.source_ia_id = '@IA'),
             'items', (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', CAST(ri.id AS CHAR), 'stock_control', ri.stock_control,
                               'serial_number_management', ri.serial_number_management))
                         FROM item ri WHERE @GATEri.tenant_id = '@T' AND ri.is_deleted = 0 AND ri.id IN (@ITEMS))) AS CHAR))"""


def requests(tenant, ia, items="0", gate=""):
    """the subquery with its tokens put in (gate: '' or a condition ending in ' AND '; it may hold a line break)"""
    assert gate == "" or gate.endswith(" AND "), gate
    out = REQUESTS.replace("@GATE", gate).replace("@ITEMS", items).replace("@IA", ia).replace("@T", tenant)
    assert "@" not in out.replace(tenant, "").replace(ia, "").replace(items, "").replace(gate, ""), out
    return out
