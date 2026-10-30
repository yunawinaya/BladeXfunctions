"""IA transfer request (ENH-20261027-001, spec IA-LT-06): the Item Assembly guard's read of its supply request, one scalar subquery for
IA_SAVE v15 (sql_node_IAguard) and IA_V2_SUBMIT v7 (sql_node_ISfacts). Tokens: @T tenant, @IA the IA's id (both digits; quoted, as
source_ia_id is varchar), @GATE a condition ANDed first (IA_V2_SUBMIT's constant gate; IA_SAVE wraps the subquery in IF instead).
Value: the IA's latest request that is not Cancelled as JSON text - id, no, status, bin (its first line's location_id) + bin_name, lines
(its lines' source_ia_line_id) - or NULL. The LOT line table has only its PRIMARY key: the lines are scanned once (LATERAL), only for a
request row found; the first line and its bin are read by id."""

REQUEST = """(SELECT CAST(JSON_OBJECT('id', CAST(rq.id AS CHAR), 'no', rq.stock_movement_no, 'status', rq.stock_movement_status,
                            'bin', CAST(rd.location_id AS CHAR), 'bin_name', rb.bin_location_combine, 'lines', rx.line_ids) AS CHAR)
           FROM sm_location_transfer rq
          CROSS JOIN LATERAL (SELECT JSON_ARRAYAGG(rl.source_ia_line_id) AS line_ids, MIN(rl.id) AS first_id
                                FROM sm_location_transfer_d2c7o1jd_sub rl
                               WHERE rl.tenant_id = '@T' AND rl.sm_location_transfer_id = rq.id
                                 AND rl.is_deleted = 0) rx
           LEFT JOIN sm_location_transfer_d2c7o1jd_sub rd ON rd.id = rx.first_id
           LEFT JOIN bin_location rb ON rb.id = rd.location_id
          WHERE @GATErq.tenant_id = '@T' AND rq.is_deleted = 0
            AND rq.transfer_purpose = 'IA_SUPPLY' AND rq.source_ia_id = '@IA'
            AND COALESCE(rq.stock_movement_status, '') <> 'Cancelled'
          ORDER BY rq.id DESC LIMIT 1)"""


def request(tenant, ia, gate=""):
    """the subquery with its tokens put in (gate: '' or a condition ending in ' AND '; it may hold a line break)"""
    assert gate == "" or gate.endswith(" AND "), gate
    out = REQUEST.replace("@GATE", gate).replace("@IA", ia).replace("@T", tenant)
    assert "@" not in out.replace(tenant, "").replace(ia, "").replace(gate, ""), out
    return out
