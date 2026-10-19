"""SQL text several packages must read identically (B SUBMIT, A PREPARE, C COMMIT A0 / A1 / A3) for the fingerprints in
code/shared/fingerprint.js. Tokens are filled with lib/v2build.sub(text, T=<tenant ref>, SA=<sa id ref>, SC=<sc id ref>):
'@T' is hand-quoted here, @SA / @SC are bare bigints (digits only - the caller's code node has checked them).
Checked read-only on dev by test/shared/fp_live.py.
"""

# the stored, live lines of one Stock Adjustment - saLineFingerprint's fields plus what the eligibility screens read
# (is_serialized_item); line_index is VARCHAR -> ordered numerically, then by id
FP_SA_LINES = """SELECT JSON_OBJECT('id', CAST(l.id AS CHAR), 'line_index', l.line_index, 'material_id', l.material_id,
       'uom_id', CAST(l.uom_id AS CHAR), 'total_quantity', l.total_quantity, 'unit_price', l.unit_price,
       'balance_index', l.balance_index, 'is_serialized_item', l.is_serialized_item) AS j
  FROM stock_adjustment_1dknywqh_sub l
 WHERE l.tenant_id = '@T'
   AND l.stock_adjustment_id = @SA
   AND l.is_deleted = 0
 ORDER BY CAST(l.line_index AS DECIMAL(20, 4)), l.id"""

# the stored, live lines of one Stock Count - scLineFingerprint's fields; id order
FP_SC_LINES = """SELECT JSON_OBJECT('id', CAST(l.id AS CHAR), 'line_index', l.line_index, 'line_status', l.line_status,
       'review_status', l.review_status, 'is_counted', l.is_counted, 'count_qty', l.count_qty, 'adjusted_qty', l.adjusted_qty,
       'variance_qty', l.variance_qty) AS j
  FROM stock_count_h4c9e1cl_sub l
 WHERE l.tenant_id = '@T'
   AND l.stock_count_id = @SC
   AND l.is_deleted = 0
 ORDER BY l.id"""
