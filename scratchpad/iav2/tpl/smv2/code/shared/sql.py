"""SQL text two packages must read identically (B SUBMIT and C COMMIT L0 / L2 for lotLineFingerprint). Tokens are filled with
lib/v2build.sub(text, T=<tenant ref>, LOT=<lot id ref>): '@T' is hand-quoted here, @LOT is a bare bigint (digits only -
the caller's code node has checked them). Checked read-only on dev by test/shared/fp_live.py.
"""

# the stored, live lines of one Location Transfer, one JSON object per row - the fields lotLineFingerprint uses
# (code/shared/fingerprint.js) plus parent_id / item_bundle_id for the eligibility screens; id order
FP_LINES = """SELECT JSON_OBJECT('id', CAST(l.id AS CHAR), 'line_index', l.line_index, 'item_selection', l.item_selection,
       'quantity_uom', CAST(l.quantity_uom AS CHAR), 'location_id', CAST(l.location_id AS CHAR), 'temp_qty_data', l.temp_qty_data,
       'parent_id', CAST(l.parent_id AS CHAR), 'item_bundle_id', l.item_bundle_id) AS j
  FROM sm_location_transfer_d2c7o1jd_sub l
 WHERE l.tenant_id = '@T'
   AND l.sm_location_transfer_id = @LOT
   AND l.is_deleted = 0
 ORDER BY l.id"""
