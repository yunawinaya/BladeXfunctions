"""patch_po_save.py <in.json> <out.json>: PO_SAVE code_fillback - a line saved with an empty expected date ('' from the form)
takes the header's date, as a missing one already did (`??` let '' through: LSH 2026-10-24, 90 lines on 46 POs saved blank).
One exact, counted replacement on the stored text; refuses on any mismatch."""
import json
import sys

src, dst = sys.argv[1:3]
raw = open(src).read()
esc = lambda t: json.dumps(t, ensure_ascii=False)[1:-1]
old = "po_expected_date: poLineItem.po_expected_date ?? entry.po_expected_date,"
new = "po_expected_date: poLineItem.po_expected_date || entry.po_expected_date,"
k = raw.count(esc(old))
assert k == 1, "%d matches (want 1)" % k
raw = raw.replace(esc(old), esc(new))
json.loads(raw)
open(dst, "w").write(raw)
print("patched ->", dst)
