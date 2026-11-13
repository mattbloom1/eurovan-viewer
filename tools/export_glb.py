"""Blender -> web GLB exporter for the EuroVan model.

Usage (see tools/README.md):
  blender -b <file.blend> -t 4 --python export_glb.py -- <out_glb> <out_manifest> [--version v32]
Works entirely in memory; never saves the .blend.
"""
import bpy, bmesh, sys, os, re, json, math, time, datetime, collections
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT_GLB, OUT_MAN = argv[0], argv[1]
VERSION = "dev"
if "--version" in argv:
    VERSION = argv[argv.index("--version") + 1]
T0 = time.time()


def log(*a):
    print("[export %6.1fs]" % (time.time() - T0), *a, flush=True)


scene = bpy.context.scene
root_obj = bpy.data.objects["Eurovan_Root"]
SHIFT = root_obj.matrix_world.translation.copy()      # moved to origin

DOOR_PIVOTS = {"Door_L_Pivot": "Door_L", "Door_R_Pivot": "Door_R", "Slider_Pivot": "Slider",
               "Tailgate_Pivot": "Tailgate", "Wheel_FL": "Wheel_FL", "Wheel_FR": "Wheel_FR",
               "Wheel_RL": "Wheel_RL", "Wheel_RR": "Wheel_RR"}
LID_NAMES = {"PopTop_Closed", "PopTop_Seal", "PopTop_Westfalia_Lettering", "Int_PopTopUnderside",
             "RoofFan_Flange", "RoofFan_Hood"}
BODY_FIXED_OVERRIDE = {"Int_PopTopFrame", "PopTop_Hinge_L", "PopTop_Hinge_R", "PopTop_Seam"}
UV_MATS = ("BO_BirchPly_", "BO_Oak_Solid", "BO_Vinyl_Plank", "BO_Paint_ForestGreen", "BO_Wool_",
           "BO_Linen_Cream", "BO_Duvet_Oat", "BO_Blanket_Stripe", "BO_Felt_Wall", "VW_Velour",
           "VW_Carpet", "VW_Headliner")

# ---------------------------------------------------------------- visibility
eff = {}


def walk(c, hid):
    h = hid or c.hide_render
    eff[c.name] = h
    for k in c.children:
        walk(k, h)


walk(scene.collection, False)


def render_visible(o):
    if o.type not in ("MESH", "CURVE"):
        return False
    if o.hide_render or not o.visible_camera:
        return False
    cols = [c.name for c in o.users_collection]
    if not cols or all(eff.get(c, False) for c in cols):
        return False
    return True


def ancestor_pivot(o):
    p = o
    while p:
        if p.name in DOOR_PIVOTS:
            return p.name
        p = p.parent
    return None


def group_of(o):
    pv = ancestor_pivot(o)
    if pv:
        return ("pivot", DOOR_PIVOTS[pv])
    if o.name in LID_NAMES:
        return ("pivot", "PopTop")
    if o.name in BODY_FIXED_OVERRIDE:
        return ("body", "Body")
    cols = [c.name for c in o.users_collection]
    if o.name.startswith("CX_Hitch_"):
        return ("bo", "BO_Hitch_Carrier")
    for c in cols:
        if c.startswith("BO_"):
            return ("bo", c)
    for c in cols:
        if c.startswith("INT_"):
            return ("interior", "Interior")
    for c in cols:
        if c.startswith("EV_") or c.startswith("VB_"):
            return ("body", "Body")
    return None


# ---------------------------------------------------------------- materials
def canon_name(n):
    return re.sub(r"\.\d{3}$", "", n)


def principled(m):
    if not m or not m.node_tree:
        return None
    return next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)


CANON = {}


def canonical(m):
    if m is None:
        return None
    if m.name in CANON:
        return CANON[m.name]
    base = canon_name(m.name)
    old = m.name
    if base == old:
        CANON[old] = m
        return m
    cm = bpy.data.materials.get(base)
    if cm is None:
        m.name = base
        cm = m
    CANON[old] = cm
    return cm


def fix_material(m):
    b = principled(m)
    if b is None:
        log("WARN material without principled:", m.name)
        return
    nt = m.node_tree
    for l in list(nt.links):
        if l.to_node == b:
            nt.links.remove(l)
    alpha = b.inputs["Alpha"].default_value
    tw = b.inputs["Transmission Weight"].default_value if "Transmission Weight" in b.inputs else 0
    if tw > 0.01:
        b.inputs["Transmission Weight"].default_value = 0.0
        if alpha >= 0.999:
            alpha = 0.25
            b.inputs["Alpha"].default_value = alpha
        log("transmission->alpha blend:", m.name, alpha)
    blend = alpha < 0.999
    try:
        m.surface_render_method = "BLENDED" if blend else "DITHERED"
    except Exception:
        pass
    try:
        m.blend_method = "BLEND" if blend else "OPAQUE"
    except Exception:
        pass
    if "Emission Strength" in b.inputs and b.inputs["Emission Strength"].default_value > 12:
        b.inputs["Emission Strength"].default_value = 12.0


# ---------------------------------------------------------------- scratch scaffolding
scratch = bpy.data.collections.new("__scratch")
scene.collection.children.link(scratch)

# make viewport evaluation match render evaluation
for o in bpy.data.objects:
    for md in o.modifiers:
        try:
            if md.type == "SUBSURF":
                md.levels = md.render_levels
            md.show_viewport = md.show_render
        except Exception:
            pass
    if o.type == "CURVE":
        try:
            o.data.bevel_resolution = min(o.data.bevel_resolution, 1)
        except Exception:
            pass
bpy.context.view_layer.update()


def tri_count(me):
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def target_for(name, tris):
    ov = [
        (r"^Eurovan_Body$", 80000), (r"^Tailgate$", 10000), (r"^Door_Front_[LR]$", 9000),
        (r"^Door_Slider$", 9000), (r"_InnerTrim$", 4000), (r"^Bumper_(Front|Rear)$", 8000),
        (r"(_Seal|WindowGaskets)$", 2500), (r"^Eurovan_Glass", 3500), (r"^Glass_", 2500),
        (r"^Int_FrontSeats", 6000), (r"^CX_Bed_Duvet$", 6000), (r"^Int_Dashboard$", 6000),
        (r"^Hood$", 5000), (r"^Jamb_Door_[LR]$", 4000), (r"^Pillar_Trims$", 3000),
        (r"^Badge_EuroVan_Script$", 1500), (r"^Cowl_Panel$", 2500),
    ]
    for pat, t in ov:
        if re.search(pat, name):
            return min(t, tris)
    if name.startswith("FX_"):
        return min(tris, 150)
    if tris <= 250:
        return tris
    if tris <= 1500:
        return int(250 + 0.35 * (tris - 250))
    return int(min(tris, 690 + 0.15 * (tris - 1500)))


def eval_mod(tmp, mod):
    d = bpy.context.evaluated_depsgraph_get()
    d.update()
    return bpy.data.meshes.new_from_object(tmp.evaluated_get(d), depsgraph=d)


def process_object(o):
    d = bpy.context.evaluated_depsgraph_get()
    eo = o.evaluated_get(d)
    me = bpy.data.meshes.new_from_object(eo, preserve_all_data_layers=False, depsgraph=d)
    if me is None or len(me.polygons) == 0:
        if me:
            bpy.data.meshes.remove(me)
        return None
    me.transform(o.matrix_world)
    if o.matrix_world.determinant() < 0:
        me.flip_normals()
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    for ca in list(me.color_attributes):
        me.color_attributes.remove(ca)
    for i, m in enumerate(me.materials):
        me.materials[i] = canonical(m)
    tris0 = tri_count(me)
    tgt = target_for(o.name, tris0)
    tris = tris0
    if tgt < tris0:
        tmp = bpy.data.objects.new("__tmp", me)
        scratch.objects.link(tmp)
        if o.name == "CX_Bed_Duvet":
            um = tmp.modifiers.new("un", "DECIMATE")
            um.decimate_type = "UNSUBDIV"
            um.iterations = 2
            m2 = eval_mod(tmp, um)
            tmp.modifiers.remove(um)
            tmp.data = m2
            bpy.data.meshes.remove(me)
            me = m2
            tris = tri_count(me)
            log("duvet unsubdiv ->", tris)
        elif tris0 > 8000:
            pm = tmp.modifiers.new("pl", "DECIMATE")
            pm.decimate_type = "DISSOLVE"
            pm.angle_limit = math.radians(1.0)
            pm.delimit = {"MATERIAL"}
            m2 = eval_mod(tmp, pm)
            tmp.modifiers.remove(pm)
            tmp.data = m2
            bpy.data.meshes.remove(me)
            me = m2
            tris = tri_count(me)
        if tgt < tris:
            dm = tmp.modifiers.new("dec", "DECIMATE")
            dm.decimate_type = "COLLAPSE"
            dm.ratio = max(0.001, tgt / tris)
            dm.use_collapse_triangulate = True
            m3 = eval_mod(tmp, dm)
            tmp.modifiers.remove(dm)
            tmp.data = m3
            bpy.data.meshes.remove(me)
            me = m3
            tris = tri_count(me)
            for _ in range(3):
                if tris <= tgt * 1.4:
                    break
                dm = tmp.modifiers.new("dec", "DECIMATE")
                dm.decimate_type = "COLLAPSE"
                dm.ratio = max(0.001, tgt / tris)
                dm.use_collapse_triangulate = True
                m3 = eval_mod(tmp, dm)
                tmp.modifiers.remove(dm)
                tmp.data = m3
                bpy.data.meshes.remove(me)
                me = m3
                tris = tri_count(me)
        scratch.objects.unlink(tmp)
        bpy.data.objects.remove(tmp)
    me.shade_smooth()
    try:
        me.set_sharp_from_angle(angle=math.radians(38))
    except Exception as e:
        log("sharp_from_angle failed", e)
    uv_needed = any(m and m.name.startswith(UV_MATS) for m in me.materials)
    if uv_needed:
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.normal_update()
        uvl = bm.loops.layers.uv.new("UVMap")
        for f in bm.faces:
            n = f.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            for l in f.loops:
                c = l.vert.co
                if ax == 0:
                    l[uvl].uv = (c.y, c.z)
                elif ax == 1:
                    l[uvl].uv = (c.x, c.z)
                else:
                    l[uvl].uv = (c.x, c.y)
        bm.to_mesh(me)
        bm.free()
    me.name = "m_" + o.name
    return me, uv_needed, tris0, tris


SEAT_SPLIT = {"Int_FrontSeats", "Int_SeatFrames", "Int_SeatRails", "Int_SeatHardware", "Int_HeadrestPosts"}


def split_passenger(me):
    """split loose parts whose centroid is on the passenger side (x < van centreline). world-space mesh."""
    bm = bmesh.new()
    bm.from_mesh(me)
    seen = set()
    pass_v, keep_v = [], []
    for v in bm.verts:
        if v.index in seen:
            continue
        st = [v]
        seen.add(v.index)
        comp = []
        while st:
            c = st.pop()
            comp.append(c)
            for e in c.link_edges:
                w = e.other_vert(c)
                if w.index not in seen:
                    seen.add(w.index)
                    st.append(w)
        cx = sum(c.co.x for c in comp) / len(comp)
        (pass_v if cx < SHIFT.x - 0.02 else keep_v).extend(comp)
    if not pass_v:
        bm.free()
        return me, None
    me2 = me.copy()
    bm2 = bmesh.new()
    bm2.from_mesh(me)
    idx = set(v.index for v in keep_v)
    bm2.verts.ensure_lookup_table()
    bmesh.ops.delete(bm2, geom=[bm2.verts[i] for i in idx], context="VERTS")
    bm2.to_mesh(me2)
    bm2.free()
    bmesh.ops.delete(bm, geom=pass_v, context="VERTS")
    bm.to_mesh(me)
    bm.free()
    me2.name = me.name + "_pass"
    return me, me2


# ---------------------------------------------------------------- collect & process
vis = [o for o in bpy.data.objects if render_visible(o)]
log("render-visible mesh/curve objects:", len(vis))
dropped = collections.defaultdict(list)
parts = collections.defaultdict(list)
stats = []
for i, o in enumerate(vis):
    g = group_of(o)
    if g is None:
        dropped["no_group"].append(o.name)
        continue
    if any(s.material and s.material.name.startswith("BO_Ground_Gravel") for s in o.material_slots):
        dropped["ground"].append(o.name)
        continue
    md = max(o.dimensions) if o.type == "MESH" else 1.0
    if (g == ("bo", "BO_Fasteners") and md < 0.015) or md < 0.004:
        dropped["tiny"].append(o.name)
        continue
    r = process_object(o)
    if r is None:
        dropped["empty"].append(o.name)
        continue
    me, uvn, t0, t1 = r
    if g == ("interior", "Interior") and o.name in SEAT_SPLIT:
        me, mp = split_passenger(me)
        if mp is not None:
            parts[("interior", "PassengerSeat_Stock")].append((o.name + "_pass", mp))
            log("passenger-side split from", o.name, len(mp.polygons), "faces")
    parts[g].append((o.name, me))
    stats.append((o.name, g, t0, t1))
    if i % 100 == 0:
        log("processed", i, "/", len(vis))
log("dropped:", {k: len(v) for k, v in dropped.items()})
log("src tris (post-modifier) %d -> %d" % (sum(s[2] for s in stats), sum(s[3] for s in stats)))

used = set()
for g, lst in parts.items():
    for n, me in lst:
        for m in me.materials:
            if m:
                used.add(m)
for m in used:
    fix_material(m)
log("materials used:", len(used))

# ---------------------------------------------------------------- build hierarchy
for o in list(scratch.objects):
    bpy.data.objects.remove(o)
final = bpy.data.collections.new("__export")
scene.collection.children.link(final)
new_objs = []


def make_empty(name, loc, parent=None):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = "PLAIN_AXES"
    e.location = loc
    final.objects.link(e)
    if parent:
        e.parent = parent
    new_objs.append(e)
    return e


def world_loc(name):
    return bpy.data.objects[name].matrix_world.translation - SHIFT


lid_hinges = [bpy.data.objects[n] for n in ("PopTop_Hinge_L", "PopTop_Hinge_R") if n in bpy.data.objects]
pts = []
for h in lid_hinges:
    pts += [h.matrix_world @ Vector(c) for c in h.bound_box]
hc = sum(pts, Vector()) / len(pts) - SHIFT
POPTOP_POS = Vector((0.0, hc.y, hc.z))

PIVOT_POS = {"Door_L": world_loc("Door_L_Pivot"), "Door_R": world_loc("Door_R_Pivot"),
             "Slider": world_loc("Slider_Pivot"), "Tailgate": world_loc("Tailgate_Pivot"),
             "PopTop": POPTOP_POS}
for w in ("FL", "FR", "RL", "RR"):
    PIVOT_POS["Wheel_" + w] = world_loc("Wheel_" + w)
# rename originals so exported names do not get .001 suffixes
for _o in list(bpy.data.objects):
    _o.name = "src_" + _o.name
for _o in list(bpy.data.collections):
    pass
van = make_empty("Van", (0, 0, 0))
body_e = make_empty("Body", (0, 0, 0), van)
int_e = make_empty("Interior", (0, 0, 0), van)
bo_e = make_empty("Buildout", (0, 0, 0), van)




PIVOT_ORDER = ["Door_L", "Door_R", "Slider", "Tailgate", "PopTop", "Wheel_FL", "Wheel_FR", "Wheel_RL", "Wheel_RR"]
PIVOT_EMPTY = {}
for k in PIVOT_ORDER:
    nm = k + "_Pivot" if not k.startswith("Wheel") else k
    PIVOT_EMPTY[k] = make_empty(nm, PIVOT_POS[k], van)


def join_group(label, plist, offset, parent):
    """plist meshes are in unshifted world space; bake into the frame at world position `offset`."""
    if not plist:
        return None
    objs = []
    M = Matrix.Translation(-(SHIFT + offset))
    for n, me in plist:
        me.transform(M)
        ob = bpy.data.objects.new(n, me)
        final.objects.link(ob)
        objs.append(ob)
    tgt = max(objs, key=lambda x: len(x.data.polygons))
    if len(objs) > 1:
        with bpy.context.temp_override(active_object=tgt, object=tgt, selected_editable_objects=objs,
                                       selected_objects=objs):
            bpy.ops.object.join()
    tgt.name = label + "_mesh"
    tgt.data.name = label + "_mesh"
    tgt.parent = parent
    tgt.location = (0, 0, 0)
    new_objs.append(tgt)
    me = tgt.data
    if me.uv_layers and me.uv_layers[0].name != "UVMap":
        me.uv_layers[0].name = "UVMap"
    return tgt


group_objs = {}


def add_simple(kind, key, empty, label):
    group_objs[label] = (empty, join_group(label, parts.get((kind, key), []), Vector(), empty))


add_simple("body", "Body", body_e, "Body")
add_simple("interior", "Interior", int_e, "Interior")
if parts.get(("interior", "PassengerSeat_Stock")):
    pe = make_empty("PassengerSeat_Stock", (0, 0, 0), int_e)
    group_objs["PassengerSeat_Stock"] = (pe, join_group("PassengerSeat_Stock", parts[("interior", "PassengerSeat_Stock")], Vector(), pe))
bo_children = {}
for (kind, key), lst in sorted(parts.items()):
    if kind == "bo" and lst:
        e = make_empty(key, (0, 0, 0), bo_e)
        bo_children[key] = e
        group_objs[key] = (e, join_group(key, lst, Vector(), e))
PIVOT_MESH_NAMES = {"Door_L": "Door_L_mesh", "Door_R": "Door_R_mesh", "Slider": "Slider_mesh",
                    "Tailgate": "Tailgate_mesh", "PopTop": "PopTop_mesh"}
for k in PIVOT_ORDER:
    ob = join_group(PIVOT_MESH_NAMES.get(k, k)[:-5] if k in PIVOT_MESH_NAMES else k, parts.get(("pivot", k), []),
                    PIVOT_POS[k], PIVOT_EMPTY[k])
    group_objs[k] = (PIVOT_EMPTY[k], ob)
    if ob:
        nm = PIVOT_MESH_NAMES.get(k, k + "_mesh")
        ob.name = nm
        ob.data.name = nm


# ---------------------------------------------------------------- stats helpers
def to_gl(v):
    return (v[0], v[2], -v[1])


def mesh_bounds_world(ob):
    off = ob.parent.location if ob.parent else Vector()
    mn = [1e9] * 3
    mx = [-1e9] * 3
    for v in ob.data.vertices:
        g = to_gl(v.co + off)
        for i in range(3):
            mn[i] = min(mn[i], g[i])
            mx[i] = max(mx[i], g[i])
    return mn, mx


def rnd(l, n=4):
    return [round(x, n) for x in l]


def tris_of(ob):
    return tri_count(ob.data) if ob else 0


def union(bl):
    bl = [b for b in bl if b]
    if not bl:
        return None
    return ([min(b[0][i] for b in bl) for i in range(3)], [max(b[1][i] for b in bl) for i in range(3)])


group_tris = {}
group_bounds = {}
for lab, (e, ob) in group_objs.items():
    group_tris[lab] = tris_of(ob)
    group_bounds[lab] = mesh_bounds_world(ob) if ob else None
bo_labels = list(bo_children)
overall = union(list(group_bounds.values()))


def entry(name, tris, b):
    return {"name": name, "tris": tris, "bounds": {"min": rnd(b[0]), "max": rnd(b[1])} if b else None}


nodes = [entry("Body", group_tris["Body"], group_bounds["Body"]),
         entry("Interior", group_tris["Interior"], group_bounds["Interior"]),
         entry("Buildout", sum(group_tris[l] for l in bo_labels), union([group_bounds[l] for l in bo_labels]))]
if "PassengerSeat_Stock" in group_tris:
    nodes.insert(2, entry("PassengerSeat_Stock", group_tris["PassengerSeat_Stock"], group_bounds["PassengerSeat_Stock"]))
for l in bo_labels:
    nodes.append(entry(l, group_tris[l], group_bounds[l]))
for k in PIVOT_ORDER:
    nm = k + "_Pivot" if not k.startswith("Wheel") else k
    nodes.append(entry(nm, group_tris[k], group_bounds[k]))
total_tris = sum(group_tris.values())
log("TOTAL TRIS", total_tris)


# ---------------------------------------------------------------- pivots (signs from geometry)
def gl_vec(v):
    return Vector(to_gl(v))


def centroid(k):
    b = group_bounds[k]
    return Vector([(b[0][i] + b[1][i]) / 2 for i in range(3)])


def hinge(k, axis, mag, outward):
    p = gl_vec(PIVOT_POS[k])
    c = centroid(k)
    axis = Vector(axis)
    rel = c - p
    d = Matrix.Rotation(0.4, 3, axis) @ rel - rel
    s = 1.0 if d.dot(Vector(outward)) > 0 else -1.0
    return {"name": k + "_Pivot", "position": rnd(list(p)), "type": "hinge", "axis": rnd(list(axis)),
            "open": round(s * mag, 4), "open_degrees": round(s * math.degrees(mag), 2)}


pivots = [hinge("Door_L", (0, 1, 0), math.radians(65), (1, 0, 0)),
          hinge("Door_R", (0, 1, 0), math.radians(65), (-1, 0, 0))]
sc_x = centroid("Slider")[0]
out = (-1.0 if sc_x < 0 else 1.0, 0.0, 0.0)
pivots.append({"name": "Slider_Pivot", "position": rnd(list(gl_vec(PIVOT_POS["Slider"]))), "type": "slide",
               "axis": [0.0, 0.0, -1.0], "open": 0.95, "out": list(out), "out_dist": 0.12})
pivots.append(hinge("Tailgate", (1, 0, 0), math.radians(85), (0, 0, -1)))
pivots.append(hinge("PopTop", (1, 0, 0), math.radians(28), (0, 1, 0)))

wheels = []
for k in PIVOT_ORDER:
    if k.startswith("Wheel") and group_bounds[k]:
        b = group_bounds[k]
        wheels.append({"name": k, "position": rnd(list(gl_vec(PIVOT_POS[k]))),
                       "radius": round((b[1][1] - b[0][1]) / 2, 4)})
wp = {w["name"]: w["position"] for w in wheels}
wheelbase = round(abs(wp["Wheel_FL"][2] - wp["Wheel_RL"][2]), 4) if "Wheel_FL" in wp and "Wheel_RL" in wp else None
track = round(abs(wp["Wheel_FL"][0] - wp["Wheel_FR"][0]), 4) if "Wheel_FL" in wp and "Wheel_FR" in wp else None

# ---------------------------------------------------------------- materials manifest
uv_mats = set()
all_mats = {}
for lab, (e, ob) in group_objs.items():
    if not ob:
        continue
    me = ob.data
    has = len(me.uv_layers) > 0
    for i in set(p.material_index for p in me.polygons):
        if i < len(me.materials) and me.materials[i]:
            all_mats[me.materials[i].name] = me.materials[i]
            if has:
                uv_mats.add(me.materials[i].name)
mats_out = []
for n in sorted(all_mats):
    b = principled(all_mats[n])
    c = b.inputs["Base Color"].default_value
    mats_out.append({"name": n, "color": [round(c[0], 4), round(c[1], 4), round(c[2], 4)],
                     "metallic": round(b.inputs["Metallic"].default_value, 3),
                     "roughness": round(b.inputs["Roughness"].default_value, 3),
                     "alpha": round(b.inputs["Alpha"].default_value, 3), "has_uv": n in uv_mats})

# ---------------------------------------------------------------- export
bpy.ops.object.select_all(action="DESELECT")
for o in new_objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = van
kw = dict(filepath=OUT_GLB, export_format="GLB", use_selection=True, export_apply=False, export_yup=True,
          export_cameras=False, export_lights=False, export_normals=True, export_texcoords=True,
          export_materials="EXPORT", export_image_format="NONE", export_animations=False,
          export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
          export_draco_position_quantization=14, export_draco_normal_quantization=10,
          export_draco_texcoord_quantization=12, export_draco_color_quantization=10,
          export_draco_generic_quantization=12, export_extras=False)
while True:
    try:
        bpy.ops.export_scene.gltf(**kw)
        break
    except TypeError as e:
        found = [k for k in kw if k in str(e)]
        if found:
            log("dropping unknown export option", found[0])
            kw.pop(found[0])
        else:
            raise
size = os.path.getsize(OUT_GLB)
manifest = {"version": VERSION, "exported": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
            "source": os.path.basename(bpy.data.filepath), "total_tris": total_tris, "glb_bytes": size,
            "bounds": {"min": rnd(overall[0]), "max": rnd(overall[1])}, "nodes": nodes, "pivots": pivots,
            "wheels": wheels, "wheelbase": wheelbase, "track": track, "materials": mats_out}
with open(OUT_MAN, "w") as f:
    json.dump(manifest, f, indent=1)
log("GLB bytes", size, "tris", total_tris)
for n in sorted(stats, key=lambda s: -s[3])[:25]:
    log("  top", n[0], n[1], n[2], "->", n[3])
for gk in (("body","Body"),("bo","BO_Concept_DI"),("bo","BO_Concept_R3L"),("interior","Interior"),("bo","BO_Fasteners"),("pivot","Door_L")):
    lst = sorted([x for x in stats if x[1] == gk], key=lambda s: -s[3])[:14]
    log("  TOP", gk, [(x[0], x[2], x[3]) for x in lst])
log("dropped detail:", {k: v[:60] for k, v in dropped.items()})
for lab in group_tris:
    log("  group", lab, group_tris[lab])
log("DONE")
