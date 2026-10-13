#!/usr/bin/env python3
"""Turn `sudu-lowcode --full workflow log <id> --plain` output into one record per node.

usage: python3 -I log_nodes.py log.json              # node table: id, type, runtime, output head
       python3 -I log_nodes.py log.json --node ID    # full INPUT/OUTPUT of one node

data.lines is the pretty-printed response split on newlines, so records span many elements
and carry wrapper lines; join them and re-split on the timestamp prefix.
"""
import json
import re
import sys

REC = re.compile(r'(?m)^(?:\s*"data":\s*")?(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d+)\|')


def records(path):
    text = '\n'.join(json.load(open(path))['data']['lines'])
    starts = [m.start(1) for m in REC.finditer(text)]
    for i, s in enumerate(starts):
        chunk = text[s:starts[i + 1] if i + 1 < len(starts) else len(text)].rstrip()
        parts = chunk.split('|', 5)
        if len(parts) == 6:
            yield {'time': parts[0], 'node': parts[2], 'title': parts[3], 'event': parts[4],
                   'payload': parts[5].replace('\\\n', '\n').replace('\\"', '"')}


def main():
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    node = args[args.index('--node') + 1] if '--node' in args else None
    nodes = {}
    order = []
    for r in records(args[0]):
        if r['event'] in ('WORKFLOW_START', 'WORKFLOW_END'):
            if not node:
                print(f"{r['time']}  {r['event']}  {r['payload'][:120]}")
            continue
        if r['node'] not in nodes:
            nodes[r['node']] = {'title': r['title']}
            order.append(r['node'])
        n = nodes[r['node']]
        if r['event'] == 'NODE_START':
            n['type'] = r['payload'].split('|')[1] if '|' in r['payload'] else ''
        elif r['event'] == 'NODE_COMPLETE':
            n['run'] = r['payload'].split('|')[0].replace('runTime=', '')
        elif r['event'] in ('NODE_INPUT', 'NODE_OUTPUT'):
            n[r['event']] = r['payload']
    if node:
        n = nodes.get(node)
        if not n:
            sys.exit(f'node {node} not in log; nodes: {", ".join(order)}')
        print(f"{node}  {n.get('type', '')}  {n['title']}  {n.get('run', '')}")
        print('--- INPUT\n' + n.get('NODE_INPUT', '(none)'))
        print('--- OUTPUT\n' + n.get('NODE_OUTPUT', '(none)'))
        return
    for nid in order:
        n = nodes[nid]
        out = ' '.join(n.get('NODE_OUTPUT', '').split())[:90]
        print(f"{nid:28} {n.get('type', ''):24} {n.get('run', ''):>6}  {out}")


if __name__ == '__main__':
    main()
