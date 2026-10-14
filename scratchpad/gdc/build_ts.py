"""Assemble DSL workflows from *.ts.tpl + code files.

In a template, CODE('path.js') (relative to the template's code/ dir) becomes the JS body as a string literal;
CODE('slice.tpl.js', {'__LIST__': 'ib', ...}) substitutes markers first. A body may pull in another file with a
line '//@include <relative path>' (the included file's CommonJS export line is dropped).

usage: python3 build_ts.py <template.ts.tpl> <out.ts>
"""
import ast, json, os, re, sys

MARK = re.compile(r"CODE\((\'[^\']+\')(?:\s*,\s*(\{[^}]*\}))?\)")


def body(path):
    src = open(path, encoding="utf-8").read()
    out = []
    for line in src.split("\n"):
        m = re.match(r"^//@include (.+)$", line.strip())
        if m:
            inc = open(os.path.normpath(os.path.join(os.path.dirname(path), m.group(1))), encoding="utf-8").read()
            inc = "\n".join(l for l in inc.split("\n") if not l.startswith("if (typeof module"))
            out.append(inc)
        else:
            out.append(line)
    return "\n".join(out)


def build(tpl, out):
    here = os.path.dirname(os.path.abspath(tpl))
    base = os.path.join(here, "code")
    text = open(tpl, encoding="utf-8").read()
    if os.path.exists(os.path.join(here, "macros.py")):
        sys.path.insert(0, here)
        import macros
        for name in sorted(macros.MACROS, key=len, reverse=True):
            text = re.sub(r"\b" + name + r"\b", lambda m, v=macros.MACROS[name]: v, text)

    def repl(m):
        js = body(os.path.join(base, ast.literal_eval(m.group(1))))
        subs = ast.literal_eval(m.group(2)) if m.group(2) else {}
        for k, v in subs.items():
            assert k in js, (m.group(1), k)
            js = js.replace(k, v)
        left = re.findall(r"__[A-Z]+__", js)
        assert not left, (m.group(1), left)
        return json.dumps(js, ensure_ascii=False)

    res = MARK.sub(repl, text)
    assert "CODE(" not in res, "unexpanded CODE marker"
    # node ids are the compiler's unless pinned: pin every node to its variable name ({{node:<id>}} tokens rely on it)
    res = re.sub(r"(?m)^(\s*)(?!/\* @id)(const (\w+) = await (?:code|sql|update|add|get|search|setCache|getCache|callWorkflow|atomicCount)\()",
                 lambda m: m.group(1) + "/* @id " + m.group(3) + " */ " + m.group(2), res)
    open(out, "w", encoding="utf-8").write(res)
    print(out, len(res), "bytes")


if __name__ == "__main__":
    build(sys.argv[1], sys.argv[2])
