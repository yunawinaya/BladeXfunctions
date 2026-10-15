"""GR list page (dev page 1902215965257617410) for GR Completion V2: a 'Processing' badge in both gr_status columns and the
throttled GR_COMPLETE_WORKER kick appended to `mounted` (Goods Receiving/CompleteV2/grc_list_mounted_kick.js). The other
list actions already refuse a Processing GR (bulk delete: Draft / Cancelled; cancel: Created; post / revert: Completed;
edit: Draft; GR_Convert_PI converts Completed only).

usage: python3 -I patch_gr_listpage.py <enabled_page.json> <out.json>
  <enabled_page.json>: the enabled page_json, parsed and re-dumped with indent=2 (key order as stored)
  <out.json>: rendered like GDlistPageJSON.json (Prettier --parser json over indent=2)
"""
import json
import os
import subprocess
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")
KICK = os.path.join(REPO, "Goods Receiving", "CompleteV2", "grc_list_mounted_kick.js")
STATUS_COLS = [("tabs", 0, 6), ("tabs", 1, 18)]

BADGE = """
<div
  v-if="scope.value==='Processing'"
  style="
    padding: 0 10px;
    border: 2px solid #8b5cf6;
    background-color: #ede9fe;
    color: #5b21b6;
    font-size: 14px;
    font-family: Arial, sans-serif;
    border-radius: 20px;
    cursor: default;
    transition: background-color 0.3s;
    width: max-content;
    display: flex;
    align-items: center;
    justify-content: center;
  "
>
  {{scope.value}}
</div>"""


def render(obj):
    r = subprocess.run(["node", PRETTIER, "--parser", "json"], input=json.dumps(obj, ensure_ascii=False, indent=2),
                       capture_output=True, text=True, check=True)
    return r.stdout


def main():
    src, out = sys.argv[1], sys.argv[2]
    page = json.load(open(src))
    for _, tab, col in STATUS_COLS:
        cfg = page["list"][0]["tabs"][tab]["list"][0]["options"]["customProps"]["columns"][col]["configCustom"]
        assert "scope.value==='Created'" in cfg["content"] and "Processing" not in cfg["content"], (tab, col)
        cfg["content"] = cfg["content"].rstrip("\n") + BADGE + "\n"
    ev = next(e for e in page["config"]["eventScript"] if e["name"] == "mounted")
    kick = open(KICK).read().strip()
    assert "GR Completion V2" not in ev["func"] and 'const WORKER = "0"' not in kick
    ev["func"] = ev["func"].rstrip() + "\n\n" + kick
    open(out, "w").write(render(page))
    print("wrote", out)


if __name__ == "__main__":
    main()
