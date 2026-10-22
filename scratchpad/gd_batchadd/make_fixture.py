"""make_fixture.py <so_no> <tenant> <out.json>: READ-ONLY - one SO's Batch Add inputs from DEV (the dialog's item_array entry,
the GD form values) and GD_STOCK_CHECK's seven reads for all its materials and lines, for harness.mjs. The output holds
tenant rows: write it to the session scratchpad, never the repo."""
import json, subprocess, sys

ROOT = '/Users/yunawinaya/Developer/BladeXfunctions'
so_no, tenant, out = sys.argv[1], sys.argv[2], sys.argv[3]


def q(sql):
    r = subprocess.run([ROOT + '/.dbtools/db', '--dev', '--json', sql], capture_output=True, text=True)
    if r.returncode:
        sys.exit(r.stderr[-800:])
    t = r.stdout
    return json.loads(t[t.find('['):]) if '[' in t else []


def coltypes(table):
    return {r['c']: r['t'] for r in q("SELECT column_name c, data_type t FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '%s'" % table)}


def api_shape(rows, types):
    """roughly what the client API returns: decimals and ints as numbers, bigint ids as strings, json parsed"""
    out = []
    for r in rows:
        o = {}
        for k, v in r.items():
            t = types.get(k, '')
            if v is None:
                o[k] = None
            elif t in ('decimal', 'double', 'float') or (t in ('int', 'tinyint', 'smallint') and k not in ('id',)):
                o[k] = float(v) if t in ('decimal', 'double', 'float') else int(v)
            elif t == 'bigint':
                o[k] = str(v)
            elif t == 'json':
                try:
                    o[k] = json.loads(v) if isinstance(v, str) else v
                except Exception:
                    o[k] = v
            else:
                o[k] = v
        out.append(o)
    return out


[so] = q("SELECT CAST(id AS CHAR) id, so_no, CAST(customer_name AS CHAR) customer_id, CAST(so_sales_person AS CHAR) sales_person, so_currency, organization_id, CAST(plant_name AS CHAR) plant_id FROM sales_order WHERE so_no = '%s' AND tenant_id = '%s' AND is_deleted = 0" % (so_no, tenant))
lines = api_shape(q("SELECT * FROM sales_order_axszx8cj_sub WHERE sales_order_id = %s AND is_deleted = 0 ORDER BY id" % so['id']), coltypes('sales_order_axszx8cj_sub'))
mats = sorted({str(l['item_name']) for l in lines if l.get('item_name') not in (None, '', '-')})
line_ids = [str(l['id']) for l in lines]
wf = json.load(open(ROOT + '/Goods Delivery/AsyncV2/GD_STOCK_CHECK.json', encoding='utf-8'))
sqls = {}


def walk(n):
    if isinstance(n, dict):
        if n.get('type') == 'sql-node':
            sqls[n['id']] = n['data'].get('sql') or n['data']['script']['code']
        for v in n.values():
            walk(v)
    elif isinstance(n, list):
        for v in n:
            walk(v)


walk(wf)
G = '{{node:code_node_fCaK9LEC.data.%s}}'
sub = lambda s: (s.replace(G % 'tenantId', tenant).replace(G % 'organizationId', so['organization_id']).replace(G % 'plantId', so['plant_id'])
                 .replace(G % 'materialIdsSql', ','.join(mats) or '0').replace(G % 'soLineIdsQuoted', ','.join("'%s'" % x for x in line_ids) or "'0'"))
names = {'sql_node_KYPOR80K': 'items', 'sql_node_ImyZgn8l': 'uom', 'sql_node_yrCiCcRB': 'pack', 'sql_node_mQefCepU': 'balances',
         'sql_node_dja8tYk1': 'batches', 'sql_node_8SE5aa7c': 'reserved', 'sql_node_uroEQbaE': 'hu'}
reads = {names[k]: q(sub(v)) for k, v in sqls.items()}
setup = q("SELECT picking_mode, default_strategy_id, fallback_strategy_id, split_policy, CAST(plant_id AS CHAR) plant_id, picking_after FROM picking_setup WHERE plant_id = %s AND picking_after = 'Goods Delivery' AND is_deleted = 0" % so['plant_id'])
fixture = {
    'so': so, 'tenant': tenant, 'reads': reads, 'picking_setup': setup,
    'item_array': [{'sales_order_id': so['id'], 'table_so': lines, 'customer_id': so['customer_id'], 'sales_order_number': so['so_no'],
                    'currency': so['so_currency'], 'sales_person': so['sales_person']}],
}
json.dump(fixture, open(out, 'w', encoding='utf-8'))
print('%s: %d lines, %d materials; reads %s; picking_setup %d' % (so_no, len(lines), len(mats), {k: len(v) for k, v in reads.items()}, len(setup)))
