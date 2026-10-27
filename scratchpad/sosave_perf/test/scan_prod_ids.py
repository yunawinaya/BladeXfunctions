"""Prod data must stay out of the repo: report every id in this work's repo files that also occurs in recorded prod data.

Recorded prod data lives in the session scratchpad only, so it is passed in; files whose name holds "dev" are dev data and
are skipped. Ids: 15-20 digit numbers, and the tenant ids the prod records carry (6 digits, "000000" is the platform's).

usage: python3 scratchpad/sosave_perf/test/scan_prod_ids.py <prod data dir> [...]   -> exit 1 on any hit
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
REPO_FILES = ["scratchpad/sosave_perf", "prod-hotfix/2026-10-27-so-save-speed", "prod-hotfix/2026-10-27-so-save-v2-speed",
              "docs/superpowers/plans/2026-10-27-so-save-v2-speed.md", "Sales Order/AsyncV2", "GlobalCreditLimitCheckWorkflow.json"]
LONG = re.compile(r"(?<![0-9])[0-9]{15,20}(?![0-9])")
TENANT_KEYS = re.compile(r'"(?:tenant_id|tenantId|system:tenantId)"\s*:\s*"?([0-9]{6})"?')


def files(path):
    if os.path.isfile(path):
        yield path
        return
    for d, subdirs, names in os.walk(path):
        subdirs[:] = [s for s in subdirs if s not in ("node_modules", "__pycache__")]
        for n in names:
            yield os.path.join(d, n)


def text(path):
    try:
        return open(path, encoding="utf8").read()
    except (UnicodeDecodeError, OSError):
        return ""


def is_workflow(path, t):
    """a workflow definition as the platform stores it: its ids are the platform's (workflows, tables, rules)"""
    if not path.endswith(".json"):
        return False
    try:
        return "nodes" in json.loads(t)
    except ValueError:
        return False


if len(sys.argv) < 2:
    raise SystemExit(__doc__)
prod_long, prod_tenants = set(), set()
for data_dir in sys.argv[1:]:
    for f in files(data_dir):
        if "dev" in os.path.basename(f).lower():
            continue
        t = text(f)
        prod_long.update(LONG.findall(t))
        prod_tenants.update(TENANT_KEYS.findall(t))
prod_tenants.discard("000000")

# ids every workflow record carries (the workflows' own ids, and GD_EDIT_SUBMIT / CHECK_APPROVAL named in the hand-off):
# platform configuration, not customer data
workflow_ids = {"2112758477792346114", "2112758538274209793", "2112758585934086146", "2112758624899170305", "2113116286771331073",
                "1990247316342333442", "1856231112670498818", "2110618741159940097", "2082344813454499841"}
# the dev test tenant every V2 test note names (110 repo files); prod has a tenant with the same id
prod_tenants.discard("496474")
hits = 0
for rel in REPO_FILES:
    for f in files(os.path.join(ROOT, rel)):
        t = text(f)
        if is_workflow(f, t):
            continue
        found = sorted(set(LONG.findall(t)) & prod_long - workflow_ids)
        found += sorted(x for x in prod_tenants if re.search(r'(?<![0-9])%s(?![0-9])' % x, t))
        if found:
            hits += len(found)
            print(f"{os.path.relpath(f, ROOT)}: {len(found)} prod id(s): {', '.join(found[:12])}{' ...' if len(found) > 12 else ''}")
print(f"{hits} prod id(s) in the repo files ({len(prod_long)} long ids, {len(prod_tenants)} tenant ids in the prod data)")
raise SystemExit(1 if hits else 0)
