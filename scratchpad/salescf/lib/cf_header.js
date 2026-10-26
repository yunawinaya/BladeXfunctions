// Header custom fields to copy: an object as is, JSON text parsed, anything else {} (only the fields are skipped, never the document)
const headerCustomFields = (v) => {
  let o = v;
  if (typeof o === "string") {
    if (!o.trim()) return {};
    try {
      o = JSON.parse(o);
    } catch (e) {
      console.log("header custom fields skipped: not JSON");
      return {};
    }
  }
  return o && typeof o === "object" && !Array.isArray(o) ? o : {};
};
