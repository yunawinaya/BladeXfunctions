// In Progress, after this run inserted the receiving child: a second In Progress run of the same transfer that
// passed search_node_PTChild at the same time inserted one too. The oldest child stays; a newer one removes itself.
const added = [{{node:add_node_u455hdU9.data}}][0];
const mine = s((Array.isArray(added) ? added[0] : added || {}).id);
const rows = dupRows([{{node:sql_node_PTdupChild.data}}][0]);
const lose = isDigits(mine) && rows.some((r) => s(r.id) === mine) && s(rows[0].id) !== mine;
return { lose: lose ? "YES" : "NO", mine: lose ? mine : "0", winner: rows.length ? s(rows[0].id) : "" };
