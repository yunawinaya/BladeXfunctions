// Duplicate guard, step 4, at the very end: this run's new Issued transfer has finished, so a repeat now gets
// REPLAY instead of WAIT. A run that stops earlier leaves it SAVING.
const prep = [{{node:code_node_PTdupPrep.data}}][0] || {};
const added = [{{node:add_node_5Wstw9z2.data}}][0];
const id = s((Array.isArray(added) ? added[0] : added || {}).id);
const stamp = s(prep.isIssuedAdd) === "YES" && isDigits(id);
return { stamp: stamp ? "YES" : "NO", id: stamp ? id : "0", uuidSaved: s(prep.uuidSaved) };
