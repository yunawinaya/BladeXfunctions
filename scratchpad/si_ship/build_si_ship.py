"""Sales Invoice: Shipping Method + Vehicle Number header fields, copied from GD, carried from the SO / GD.

  python3 scratchpad/si_ship/build_si_ship.py

Writes out/ (dev, built on the live dev versions in base/) and out/prod/ (built on the live prod versions in base/prod/).

Form: si_shipping_method (GD di_shipping_method: table-select on Shipping Method) and si_vehicle_number (GD di_vehicle_number:
select on Vehicle, with GD's "+" add-vehicle dialog) after Project in the header's right column. Both stay editable on
Completed / Fully Posted SIs (user 10-26: their Update buttons save the whole form), so they are NOT in mounted's
disabledField list. The publish derives the two columns from the form.
Fill (user 10-26, second ask): SO / GD di_shipping_method + di_vehicle_number -> SI, from the first source document like the
other header fields.
  - form onChange_soID (fired by the batch add's setData of so_id): from the first GD when the lines came from one (one
    projected read, parallel with the SO read it already makes), else from the first SO.
  - GD_Convert_SI / SO_Convert_SI: both columns added to the header sql-node and to the header map.
  - SO_SAVE auto SI (Issued SO with auto_si): header map (it reads the whole SO with a get-node).
SI_SAVE: both written by Add Data and Update Data (fixed prop lists; a field missing there is never stored).
"""
import copy, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
BASE, OUT = os.path.join(HERE, "base"), os.path.join(HERE, "out")
load = lambda n: json.load(open(os.path.join(BASE, n)))

FIELDS = [  # (GD model, SI model, new key)
    ("di_shipping_method", "si_shipping_method", "sm5hq2vt"),
    ("di_vehicle_number", "si_vehicle_number", "vn7kx3pd"),
]
VEHICLE_BTN_KEY, VEHICLE_BTN_NAME = "vb4rc8wn", "onSiVehicleNumberfunc"

FAX = "    shipping_address_fax: record.shipping_address_fax,\n"
HEADER_MAP = (FAX, FAX + "    si_shipping_method: record.di_shipping_method,\n    si_vehicle_number: record.di_vehicle_number,\n")


def find(node, model):
    if isinstance(node, dict):
        if node.get("model") == model:
            return node
        node = list(node.values())
    if isinstance(node, list):
        for v in node:
            hit = find(v, model)
            if hit:
                return hit
    return None


def swap(text, old, new):
    assert text.count(old) == 1, (old[:60], text.count(old))
    return text.replace(old, new)


SO_ID_READ = """(async () => {
  const soID = this.getValue("so_id");

  if (soID.length > 0) {
    const resSO = await db
      .collection("sales_order")
      .where({ id: soID[0] })
      .get();
"""
SO_ID_READ_NEW = """(async () => {
  const soID = this.getValue("so_id");
  const gdID = (this.getValue("gd_id") || []).filter(Boolean);

  if (soID.length > 0) {
    // Shipping Method / Vehicle Number come from the first delivery when the lines came from one, else from the order
    const [resSO, resGD] = await Promise.all([
      db.collection("sales_order").where({ id: soID[0] }).get(),
      gdID.length > 0
        ? db
            .collection("goods_delivery")
            .field("di_shipping_method,di_vehicle_number")
            .where({ id: gdID[0] })
            .get()
        : null,
    ]);
    const shippingSource = resGD?.data?.[0] || resSO.data[0];
"""
SO_ID_SET = "      project_id: resSO.data[0].project_id,\n"
SO_ID_SET_NEW = SO_ID_SET + (
    "      si_shipping_method: shippingSource.di_shipping_method || \"\",\n"
    "      si_vehicle_number: shippingSource.di_vehicle_number || \"\",\n")


def build_form(base_name):
    si, gd = load(base_name), load("GD_form.dev_v1492.json")
    right = si["list"][5]["columns"][1]["list"]
    assert right[0]["model"] == "project_id", right[0]["model"]
    widgets = []
    for gd_model, si_model, key in FIELDS:
        assert find(si, si_model) is None, si_model
        w = copy.deepcopy(find(gd, gd_model))
        w.update(key=key, model=si_model)
        w["options"].update(remoteFunc=f"func_{key}", remoteOption=f"option_{key}", disabled=False)
        widgets.append(w)
    vehicle = widgets[1]
    assert vehicle["options"]["buttonEvent"] == [{"key": "pqjfqfd3", "name": "onDiVehicleNumberfunc"}]
    vehicle["options"]["buttonEvent"] = [{"key": VEHICLE_BTN_KEY, "name": VEHICLE_BTN_NAME}]
    # GD's grid wraps its labels; on the SI header that put "Vehicle Number" on two lines beside Shipping Method
    vehicle["options"]["labelWrap"] = False
    # GD's widget has no buttonText, so its "+" reads the platform default "新增"; SO's di_vehicle_number sets "Add"
    vehicle["options"]["buttonText"] = "Add"
    right[1:1] = widgets

    scripts = si["config"]["eventScript"]
    gd_btn = next(e for e in gd["config"]["eventScript"] if e.get("key") == "pqjfqfd3")
    func = gd_btn["func"].replace("di_vehicle_number:", "si_vehicle_number:")
    assert func != gd_btn["func"]
    scripts.append({"key": VEHICLE_BTN_KEY, "name": VEHICLE_BTN_NAME, "func": func, "type": "js"})

    so_id = next(e for e in scripts if e.get("name") == "onChange_soID")
    so_id["func"] = swap(swap(so_id["func"], SO_ID_READ, SO_ID_READ_NEW), SO_ID_SET, SO_ID_SET_NEW)
    return si


def nodes_by_id(wf):
    found = {}

    def walk(n):
        if isinstance(n, dict):
            if "id" in n and isinstance(n.get("data"), dict):
                found[n["id"]] = n
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(wf["nodes"])
    return found


def patch_code(wf, node_id, *pairs):
    script = nodes_by_id(wf)[node_id]["data"]["script"]
    for old, new in pairs:
        script["code"] = swap(script["code"], old, new)


def build_si_save(base_name):
    wf = load(base_name)
    nodes = nodes_by_id(wf)
    for nid in ("add_node_adYeQB4a", "update_node_I7KGszOE"):
        props = nodes[nid]["data"]["props"]["list"]
        assert not any(p["prop"] in ("si_shipping_method", "si_vehicle_number") for p in props)
        for prop, label in (("si_shipping_method", "Shipping Method"), ("si_vehicle_number", "Vehicle Number")):
            props.append({"prop": prop, "operator": "", "valueType": "field",
                          "value": f"{{{{node:code_si_prep.data.entry.{prop}}}}}", "valueLabel": "", "propLabel": label})
    return wf


def sql_cols(alias):
    old = f"'project_id', CAST({alias}.project_id AS CHAR)) AS j"
    return (old, f"'project_id', CAST({alias}.project_id AS CHAR),\n"
                 f"       'di_shipping_method', {alias}.di_shipping_method, 'di_vehicle_number', CAST({alias}.di_vehicle_number AS CHAR)) AS j")


def build_gd_convert(base_name):
    wf = load(base_name)
    patch_code(wf, "sql_node_gdcvDone", sql_cols("g"))
    patch_code(wf, "code_node_sQX9tldw",
               ('"shipping_address_state", "shipping_address_country", "project_id"], ["id", "parent_id", "good_delivery_uom_id"',
                '"shipping_address_state", "shipping_address_country", "project_id", "di_vehicle_number"], ["id", "parent_id", "good_delivery_uom_id"'),
               HEADER_MAP)
    return wf


def build_so_convert(base_name):
    wf = load(base_name)
    patch_code(wf, "sql_node_socvDone", sql_cols("s"))
    patch_code(wf, "code_node_sQX9tldw",
               ('"shipping_address_state", "shipping_address_country", "project_id"], ["id", "parent_id", "sales_person_id"',
                '"shipping_address_state", "shipping_address_country", "project_id", "di_vehicle_number"], ["id", "parent_id", "sales_person_id"'),
               HEADER_MAP)
    return wf


def build_so_save(base_name):
    wf = load(base_name)
    patch_code(wf, "code_node_CVVyuAj3", HEADER_MAP)
    return wf


TARGETS = {  # out file: (builder, dev base, prod base)
    "SI_form.json": (build_form, "SI_form.dev_v389.json", "prod/SI_form.prod_v200.json"),
    "SI_SAVE.json": (build_si_save, "SI_SAVE.dev_v84.json", "prod/SI_SAVE.prod_v84.json"),
    "GD_Convert_SI.json": (build_gd_convert, "GD_Convert_SI.dev_v29.json", "prod/GD_Convert_SI.prod_v26.json"),
    "SO_Convert_SI.json": (build_so_convert, "SO_Convert_SI.dev_v58.json", "prod/SO_Convert_SI.prod_v38.json"),
    "SO_SAVE.json": (build_so_save, "SO_SAVE.dev_v172.json", "prod/SO_SAVE.prod_v88.json"),
}

if __name__ == "__main__":
    os.makedirs(os.path.join(OUT, "prod"), exist_ok=True)
    for name, (build, dev_base, prod_base) in TARGETS.items():
        for out, base in ((name, dev_base), (os.path.join("prod", name), prod_base)):
            json.dump(build(base), open(os.path.join(OUT, out), "w"), ensure_ascii=False, indent=1)
            print("wrote", os.path.join("out", out), "from", base)
