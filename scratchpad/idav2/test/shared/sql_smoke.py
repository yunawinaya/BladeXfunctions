"""Offline smoke of code/shared/sql.py (no database): every statement fills with lib/v2build.sub, leaves no @TOKEN, starts with SELECT /
WITH and never holds the word SET (scratchpad/validate.py's SQLSTART rule), wraps to <= 160-character lines (lib/v2build.wrap_sql), declares
the tokens STATEMENTS lists and returns the columns it lists; facts() / op_state() fill too.

python3 scratchpad/idav2/test/shared/sql_smoke.py"""
import importlib.util
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
IDAV2 = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(IDAV2, "lib"))
import v2build as V  # noqa: E402

spec = importlib.util.spec_from_file_location("ida_shared_sql", os.path.join(IDAV2, "code", "shared", "sql.py"))
S = importlib.util.module_from_spec(spec)
spec.loader.exec_module(S)

VALS = {"T": "000000", "IDA": "2110985744909729793", "JOB": "2110985744909729793", "ORG": "1123598813738675201", "ITEMS": "0,2107721546371891202",
        "HEX": '["626174636822"]', "KEY": "IDA:1123598813738675201:2110985744909729793:0000000000000000:1", "SIDE": "I"}
problems = []


def check(name, text, cols=None, tokens=None):
    if tokens is not None:
        found = sorted(set(re.findall(r"@([A-Z]{2,}|T\b)", text)))
        if found != sorted(tokens):
            problems.append("%s: tokens %s, STATEMENTS lists %s" % (name, found, sorted(tokens)))
    filled = V.sub(text, **{k: VALS[k] for k in (tokens or [])}) if tokens is not None else text
    head = re.sub(r"^(\s|--[^\n]*\n|/\*.*?\*/)*", "", filled, flags=re.S)
    if not re.match(r"(?i)(select|with)\b", head):
        problems.append(name + ": does not start with SELECT / WITH")
    if re.search(r"(?i)\bset\b", filled):
        problems.append(name + ": holds the word SET")
    if "{{" in filled or re.search(r"@[A-Z]{2,}", filled):
        problems.append(name + ": a token is left")
    wrapped = V.wrap_sql(filled)
    longest = max(len(line) for line in wrapped.split("\n"))
    if longest > 160:
        problems.append("%s: a %d-character line after wrap_sql" % (name, longest))
    for c in cols or []:
        if not re.search(r"(?i)\bAS\s+%s\b|\b[a-z]\.%s\b" % (re.escape(c), re.escape(c)), filled):
            problems.append("%s: column %s not selected" % (name, c))
    print("%s %-20s %5d chars, longest line %3d" % ("ok  " if not [p for p in problems if p.startswith(name + ":")] else "FAIL", name, len(filled), longest))


for name, (text, tokens, cols) in S.STATEMENTS.items():
    check(name, text, cols, tokens)
check("FACTS (stored)", S.facts(V.sub, T=VALS["T"], IDA=VALS["IDA"], KEY=VALS["KEY"], ORG=VALS["ORG"]), S.FACTS_COLS)
check("FACTS (add)", S.facts(V.sub, T=VALS["T"], IDA="0", KEY=VALS["KEY"], ORG=VALS["ORG"]), S.FACTS_COLS)
for side in ("I", "R"):
    check("OP_STATE " + side, S.op_state(V.sub, T=VALS["T"], JOB=VALS["JOB"], SIDE=side), S.OP_STATE_COLS)
try:
    S.op_state(V.sub, T="000000", JOB="1", SIDE="X")
    problems.append("op_state accepted SIDE X")
except AssertionError:
    pass
if S.job_obj("k").count("k.") != 13:
    problems.append("job_obj: not 13 alias references")
for p in problems:
    print("PROBLEM " + p)
print("problems: %d" % len(problems))
sys.exit(1 if problems else 0)
