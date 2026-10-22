"""build_batchadd_v2.py <live GD form.json> <out form.json> <out handler.js>: Batch Add (onConfirm_batchAddItem) reads its
stock facts from GD_STOCK_CHECK, as Convert to GD (gdV2_func_processGDLineItem) does since dev v1444 (10-22).

Why: the live Batch Add reads the Item master ONCE PER LINE, one after another (createTableGdWithBaseUOM -> buildRow), and
the handling units once per material; SO/20261020/046 (2,004 lines, 499 materials) = 2,004 sequential Item reads + 499 more.
GD_STOCK_CHECK answers every fact of <= 50 lines in one call (4 in flight).

What changes, nothing else:
- the V2 data layer, copied byte for byte from the live gdV2_func_processGDLineItem (gdV2StockRequests, gdV2MergeFacts,
  gdV2Org, gdV2Call, isRealId, realIds, gdV2FactsPromise, gdV2FactsMaps, gdV2LoadStockFacts) + GD_V2_WF.STOCK_CHECK and
  UXC.stock_chunk;
- the five batch loaders keep their old bodies as legacy*, and the new ones answer from the facts: the legacy read runs when
  the facts failed (GD_STOCK_CHECK down, no plant) and for an item the facts lack;
- fetchHUData and buildRow's per-line Item read answer from the facts, the old read kept as the fallback;
- main loads the facts once, from every picked line (bundle items included), right before the table is built.
"""
import json
import re
import sys

base, out_form, out_js = sys.argv[1], sys.argv[2], sys.argv[3]
form = json.load(open(base, encoding='utf-8'))
es = form['config']['eventScript']
[bi] = [i for i, e in enumerate(es) if e.get('name') == 'onConfirm_batchAddItem']
[vi] = [i for i, e in enumerate(es) if e.get('name') == 'gdV2_func_processGDLineItem']
src, v2 = es[bi]['func'], es[vi]['func']
n0 = len(src)
assert 'gdV2LoadStockFacts' not in src, 'already ported'


def top_level(text, name):
    """the text of one top-level const / let declaration, up to the next top-level statement"""
    m = re.search(r'^(?:const|let) %s = ' % re.escape(name), text, re.M)
    assert m, name
    nxt = re.search(r'^(?:const |let |\(async |// =====)', text[m.end():], re.M)
    lines = text[m.start():m.end() + nxt.start()].rstrip().split('\n')
    while lines and (lines[-1].startswith('//') or not lines[-1].strip()):
        lines.pop()  # the next declaration's own comment
    return '\n'.join(lines) + '\n'


def once(text, old, new):
    assert text.count(old) == 1, 'anchor not unique (%d): %r' % (text.count(old), old[:90])
    return text.replace(old, new)


helpers = ''.join(top_level(v2, n) + '\n' for n in ['gdV2StockRequests', 'gdV2MergeFacts'])
helpers += v2[v2.index('// The delivery\'s organization'):v2.index('const gdV2Org = ')] + top_level(v2, 'gdV2Org') + '\n'
helpers += v2[v2.index('// One workflow call as a promise'):v2.index('const gdV2Call = ')] + top_level(v2, 'gdV2Call') + '\n'
helpers += ''.join(top_level(v2, n) for n in ['isRealId', 'realIds']) + '\n'
helpers += ''.join(top_level(v2, n) for n in ['gdV2FactsPromise', 'gdV2FactsMaps', 'gdV2LoadStockFacts']) + '\n'

layer = (
    '// ============================================================================\n'
    '// V2 data layer (10-22): the stock facts of the picked lines from GD_STOCK_CHECK, as Convert to GD reads them\n'
    '// (gdV2_func_processGDLineItem, copied from it byte for byte); the old reads below stay as the fallback.\n'
    '// ============================================================================\n'
    'const GD_V2_WF = {\n'
    '  STOCK_CHECK: "2105663605526925314", // GD_STOCK_CHECK\n'
    '};\n'
    'const UXC = { stock_chunk: 50 };\n'
    + helpers +
    '// The facts of this Batch Add; a loader called before they were loaded reads the old way.\n'
    'const gdV2Facts = () => gdV2FactsPromise || Promise.resolve({ failed: "the stock facts were not loaded" });\n\n'
)
anchor = '// A picked entry that is a bundle rather than an item.\n'
src = once(src, anchor, layer + anchor)

LOADERS = {
    'batchFetchItems': '(materialIds)',
    'batchFetchBalanceData': '(materialIds, plantId)',
    'batchFetchBinLocations': '(locationIds)',
    'batchFetchBatchData': '(materialIds, plantId)',
    'batchFetchPendingReserved': '(soLineItemIds, plantId)',
}
for name, args in LOADERS.items():
    src = once(src, 'const %s = async %s => {' % (name, args), 'const legacy%s%s = async %s => {' % (name[0].upper(), name[1:], args))
    new = top_level(v2, name)
    m = re.search(r'\n  const facts = await gdV2LoadStockFacts\([^)]*\);\n', new)
    assert m, name + ': V2 facts line'
    fallback = '\n  const facts = await gdV2Facts();\n  if (facts.failed) return legacy%s%s%s;\n' % (name[0].upper(), name[1:], args)
    new = new[:m.start()] + fallback + new[m.end():]
    if name == 'batchFetchItems':
        new = once(new, '  console.log(`GD V2: ${itemMap.size} items from GD_STOCK_CHECK (no extra request)`);\n',
                   '  const missing = realIds(materialIds).filter((id) => !itemMap.has(String(id)));\n'
                   '  if (missing.length) (await legacyBatchFetchItems(missing)).forEach((item, id) => itemMap.set(id, item));\n'
                   '  console.log(`GD V2: ${itemMap.size} items from GD_STOCK_CHECK (${missing.length} read the old way)`);\n')
    at = src.index('\n};\n', src.index('const legacy%s%s = ' % (name[0].upper(), name[1:]))) + 4
    src = src[:at] + '\n' + new + src[at:]

src = once(src,
           '  const fetchHUData = async () => {\n    const huResults = await Promise.all(\n',
           '  const fetchHUData = async () => {\n'
           '    const facts = await gdV2Facts();\n'
           '    if (!facts.failed) return new Set(materialIds.filter((id) => facts.hu.has(String(id))));\n'
           '    const huResults = await Promise.all(\n')

src = once(src,
           '    let itemData = null;\n    if (item.itemId) {\n      try {\n        const res = await db\n          .collection("Item")\n          .where({ id: item.itemId })\n',
           '    let itemData = null;\n'
           '    const facts = item.itemId ? await gdV2Facts() : null;\n'
           '    if (facts && !facts.failed) itemData = facts.items.get(String(item.itemId)) || null;\n'
           '    if (item.itemId && !itemData) {\n      try {\n        const res = await db\n          .collection("Item")\n          .where({ id: item.itemId })\n')

src = once(src,
           '  let newTableGd = await createTableGdWithBaseUOM(allItems);\n',
           '  // V2: every stock fact of the picked lines (bundle items too), one GD_STOCK_CHECK call per <= 50 lines\n'
           '  gdV2FactsPromise = null;\n'
           '  await gdV2LoadStockFacts(flattenAllItems(allItems), this.getValue("plant_id"));\n'
           '  let newTableGd = await createTableGdWithBaseUOM(allItems);\n')

es[bi]['func'] = src
open(out_js, 'w', encoding='utf-8').write(src)
json.dump(form, open(out_form, 'w', encoding='utf-8'), ensure_ascii=False)
print('onConfirm_batchAddItem: %d -> %d chars; eventScript[%d] replaced' % (n0, len(src), bi))
