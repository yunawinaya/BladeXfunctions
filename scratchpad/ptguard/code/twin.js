// Duplicate guard, step 3, right after this run's header insert and before any stock moves: two saves of the same
// key or content can both pass step 2 and both insert. The oldest row wins; a newer one removes its own header and
// answers with the winner, so only one transfer moves stock.
const added = [{{node:@ADD.data}}][0];
const mine = s((Array.isArray(added) ? added[0] : added || {}).id);
const pool = dupPool(dupRows([{{node:@SQL.data}}][0]));
const keep = { lose: "NO", mine: "0", route: "GO", code: "200", message: "", result_code: "", id: "", stock_movement_no: "", stock_movement_status: "", replayed: "0" };
if (!isDigits(mine) || !pool.some((r) => s(r.id) === mine) || s(pool[0].id) === mine) return keep;
return Object.assign(dupAnswer(pool[0]), { lose: "YES", mine: mine });
