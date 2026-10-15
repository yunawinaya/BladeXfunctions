// value comparison for read-backs: "" / null / undefined are one nothing; numbers compare at 8 dp; ids and text exactly
const sameVal = function sameVal(a, b) {
  const ea = a === undefined || a === null || a === "";
  const eb = b === undefined || b === null || b === "";
  if (ea || eb) return ea && eb;
  if (typeof a === "object" || typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  const na = typeof a === "number" || /^-?[0-9]+(\.[0-9]+)?$/.test(String(a));
  const nb = typeof b === "number" || /^-?[0-9]+(\.[0-9]+)?$/.test(String(b));
  if (na && nb && String(a).replace(/\.0+$/, "").length < 16 && String(b).replace(/\.0+$/, "").length < 16) return Math.abs(q8(a) - q8(b)) < 1e-8;
  return String(a) === String(b);
};
const parseJ = function parseJ(t) {
  try {
    return JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));
  } catch (e) {
    return null;
  }
};
// a computed value against what the platform stored: equal at 1e-8, or the stored value is the computed one rounded by the
// tenant's number rule (0-7 dp; half-up, toward zero or away from zero - su_code_num_precision's modes)
const sameStored = function sameStored(computed, stored) {
  if (sameVal(computed, stored)) return true;
  if (typeof computed === "object" || computed === "" || computed === null || computed === undefined || stored === "" || stored === null || stored === undefined) return false;
  const a = Number(computed);
  const b = Number(stored);
  if (!isFinite(a) || !isFinite(b)) return false;
  for (let d = 0; d < 8; d++) {
    const f = Math.pow(10, d);
    const x = Number((a * f).toFixed(6));
    for (const c of [Math.sign(x) * Math.round(Math.abs(x)), Math.trunc(x), Math.sign(x) * Math.ceil(Math.abs(x))]) if (Math.abs(c / f - b) < 1e-9) return true;
  }
  return false;
};
