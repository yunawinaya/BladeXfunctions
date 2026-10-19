// The GDs on this Picking, quoted for the line count below (digits only).
const ids = ({{node:code_node_oHIIKfiw.data.gdIds}} || [])
  .map((x) => String(x))
  .filter((x) => /^[0-9]{1,20}$/.test(x));
return { gdIdCsv: ids.length > 0 ? ids.map((x) => "'" + x + "'").join(",") : "'0'" };
