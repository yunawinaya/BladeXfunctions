# LSH IA print: Request Raw Mat Qty prints the issued quantity (2026-10-26)

**Why.** IAH-2610-49 (tenant 128671): the print showed 40.5 under Request Raw Mat Qty, the IA issued 2 CTN. The print read the line's
`requested_qty`, which on that IA was worked out for 810 Paket (40.5 Ctn) and never re-scaled to the 40 produced. The user chose to
print the line's picked / issued quantity (`total_quantity`) in that column instead.

**What changes** (page "LSH IA", id `2069438052207247362`; DEV v3 == PROD v3, checked 2026-10-26):
- the component row's Request Raw Mat Qty cell (`lshia00037`): `requested_qty` -> `total_quantity` (same formatting);
- the components datasource `more_fields`: `requested_qty` -> `total_quantity`;
- `config.deps.flex_ia_components`: the two `requested_qty` entries -> `total_quantity`.
Nothing else. "LSH Raw Material Request" (`2035775619428347906`) is not changed.

**Files.** `lsh_ia_print.v3.deployed.json` = the deployed page (base); `build.py` makes `lsh_ia_print.v4.json` (DEV publish and
PROD paste: the same content).

**PROD (the user):** open page `2069438052207247362` ("LSH IA") in the PROD designer, replace its JSON with `lsh_ia_print.v4.json`,
publish. Check: print IAH-2610-49 -> the flakes line shows 2 under Request Raw Mat Qty.
