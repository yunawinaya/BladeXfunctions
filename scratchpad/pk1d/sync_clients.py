"""sync_clients.py [--write]: Picking V2 1d's client handlers into the page / form JSONs the platform runs (the fullJSON mirrors
the .js files - edit both). Patched as TEXT from the repo's own files snapshotted in base/ (= deployed dev: list page v220,
Picking form v436), so each diff is the handlers only; the result is asserted equal to the snapshot with exactly those funcs.
Published 10-20 as list page v221 (built on the v221 designer draft: deploy/PickingListPage.v221+1d.json) and form v437; after a
handler change run --write, then --published-page --write (the repo page also carries v221's designer defaults)."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
R = "/Users/yunawinaya/Developer/BladeXfunctions/"
TARGETS = [
    ("Picking/PickingListPageFullJSON.json", "PickingListPage.v220.repo.json", "PickingListPage.v220.json", "page_json", [
        ("lkaac27r", "Picking/AsyncV2/pkV2_listForceComplete.js"),            # Force Complete (was ForceCompleteWorkflow.js)
        ("0xheshn9", "Bulk Actions/Warehouse Management/Picking/RevertCompleted.js"),
        ("mounted", "Picking Plan/PPonMountedListPage.js"),
    ]),
    ("Picking/PickingFullJSON.json", "PickingForm.v436.repo.json", None, "form_json", [
        ("mounted", "Picking/PickingOnMounted.js"),
    ]),
]


def enc(x):
    return json.dumps(x, ensure_ascii=False)[1:-1]


def object_span(text, path):
    """[start, end] offsets of the JSON object at `path` (keys / indices) in `text`, by a scan that tracks the path"""
    i, stack = 0, []  # stack items: [container kind, current key or index]
    while i < len(text):
        c = text[i]
        if c == '"':
            j = i + 1
            while text[j] != '"':
                j += 2 if text[j] == "\\" else 1
            if stack and stack[-1][0] == "{" and stack[-1][2] == "key":
                stack[-1][1] = json.loads(text[i:j + 1])
                stack[-1][2] = "colon"
            i = j + 1
            continue
        if c in "{[":
            if [s[1] for s in stack] == path and c == "{":
                start, depth, k = i, 0, i
                while True:
                    if text[k] == '"':
                        k += 1
                        while text[k] != '"':
                            k += 2 if text[k] == "\\" else 1
                    elif text[k] in "{[":
                        depth += 1
                    elif text[k] in "}]":
                        depth -= 1
                        if depth == 0:
                            return start, k
                    k += 1
            stack.append([c, 0 if c == "[" else None, "key" if c == "{" else "item"])
        elif c in "}]":
            stack.pop()
        elif c == ",":
            if stack[-1][0] == "[":
                stack[-1][1] += 1
            else:
                stack[-1][2] = "key"
        i += 1
    raise KeyError(path)


def add_members(text, path, members):
    """the members inserted before the object's closing brace, in its last member's indentation"""
    start, end = object_span(text, path)
    body = text[start:end]
    line_start = body.rfind("\n")
    indent = body[line_start + 1:len(body) - len(body[line_start + 1:].lstrip())] if line_start >= 0 else ""
    member_indent = indent + "  "
    last = body.rstrip()
    add = "".join(",\n" + member_indent + json.dumps(k, ensure_ascii=False) + ": " + json.dumps(v, ensure_ascii=False) for k, v in members)
    return text[:start] + last + add + "\n" + indent + "}" + text[end + 1:]


# the published list page (v221) carries designer defaults the repo's v220 copy lacks: mirrored into the repo file
PAGE_V221_PROPS = [(["list", 0, "tabs", 1, "list", 0, "options", "customProps"], ["summaryColor"]),
                   (["list", 1, "options", "customProps", "columns", 6], ["align", "allowEditFx", "columnEvents", "defaultHidden", "hoverView", "showStyle"])]


# the list page as last published: v221 + the 1d handlers (10-20), then v222 = the force complete switch on (10-21)
PUBLISHED_PAGE = "PickingListPage.fcon.json"


def mirror_published_page(write):
    path = R + "Picking/PickingListPageFullJSON.json"
    published = json.load(open(os.path.join(HERE, "deploy", PUBLISHED_PAGE), encoding="utf-8"))
    text = open(path, encoding="utf-8").read()
    for p, keys in PAGE_V221_PROPS:
        node = published
        for k in p:
            node = node[k]
        current = json.loads(text)
        for k in p:
            current = current[k]
        todo = [(k, node[k]) for k in keys if k not in current]
        if todo:
            text = add_members(text, p, todo)
    assert json.loads(text) == published, "the repo page is not the published one"
    print("Picking/PickingListPageFullJSON.json = the published list page (" + PUBLISHED_PAGE + ")")
    if write:
        open(path, "w", encoding="utf-8").write(text)
        print("   written")


def main():
    write = "--write" in sys.argv
    if "--published-page" in sys.argv:
        return mirror_published_page(write)
    for path, repo_base, db_base, _kind, events in TARGETS:
        text = open(os.path.join(HERE, "base", repo_base), encoding="utf-8").read()
        doc = json.loads(text)
        if db_base:
            assert json.load(open(os.path.join(HERE, "base", db_base), encoding="utf-8")) == doc, repo_base + " is not the deployed " + db_base
        want = json.loads(text)
        out = text
        for key, src in events:
            ev = [e for e in doc["config"]["eventScript"] if e.get("key") == key or e.get("name") == key]
            assert len(ev) == 1, "%s: %d handlers %s" % (path, len(ev), key)
            old = ev[0]["func"]
            new = open(R + src, encoding="utf-8").read()
            new = new if old.endswith("\n") else new.rstrip("\n")
            assert out.count(enc(old)) == 1, "%s: the %s handler's text occurs %d times" % (path, key, out.count(enc(old)))
            out = out.replace(enc(old), enc(new))
            [e for e in want["config"]["eventScript"] if e.get("key") == key or e.get("name") == key][0]["func"] = new
            print("%s: %s <- %s (%d -> %d chars)" % (path, key, src, len(old), len(new)))
        assert json.loads(out) == want, path + ": the text patch changed more than the handlers"
        if write:
            open(R + path, "w", encoding="utf-8").write(out)
            print("   written")


if __name__ == "__main__":
    main()
