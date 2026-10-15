const rows = {{node:sql_node_LockGate.data}} || [];
const list = Array.isArray(rows) ? rows : [rows];
const row = list[0];

// A crashed run can never release the mutex in-flow, so a lock this old is
// treated as abandoned and taken over.
const STALE_SEC = 900;

// 0 = free, take the lock   1 = held by a live run   2 = already Completed
let lockState = 1;
let staleRecovered = 0;

if (row && row.id) {
  if (row.to_status === "Completed") {
    lockState = 2;
  } else if (Number(row.is_processing) === 1) {
    const age = Number(row.lock_age_sec);
    // A negative or unparseable age means the clock assumption is off; stay
    // locked rather than risk stealing a lock from a run still in progress.
    if (isFinite(age) && age > STALE_SEC) {
      lockState = 0;
      staleRecovered = 1;
    }
  } else {
    lockState = 0;
  }
}

// A background job of this putaway (Putaway V2) or its Goods Receiving still being saved in the background holds it:
// the same answer as a live lock, so the mobile app keeps retrying
if (row && row.id && lockState !== 2 && (Number(row.open_jobs) > 0 || String(row.gr_status || "") === "Processing")) {
  lockState = 1;
  staleRecovered = 0;
}

return {
  lockState,
  staleRecovered
}
