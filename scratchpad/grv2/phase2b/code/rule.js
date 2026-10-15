// counted as GOODS_RECEIVING does (a bundle's items are not counted, the bundle line is)
const poGrStatus = (r) => {
  const n = (v) => Number(v) || 0;
  if (n(r.reserved) > 0) return "Created";
  if (n(r.countable) > 0 && n(r.fully) === n(r.countable)) return "Fully Received";
  if (n(r.partially) > 0) return "Partially Received";
  return "Cancelled";
};
