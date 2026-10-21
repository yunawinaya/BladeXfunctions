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
