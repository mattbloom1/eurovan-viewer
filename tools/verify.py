"""Re-import van.glb in a fresh Blender, print the node tree / stats, render check images.
blender -b --factory-startup --python verify.py -- <van.glb> <manifest.json> <outdir>
"""
import bpy, sys, json, math, os
from mathutils import Vector, Quaternion

glb, man_path, outdir = sys.argv[sys.argv.index("--") + 1:][:3]
man = json.load(open(man_path))
os.makedirs(outdir, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)


def tree(o, d=0):
    extra = ""
    if o.type == "MESH":
        me = o.data
        me.calc_loop_triangles()
        extra = " tris=%d mats=%d uv=%d" % (len(me.loop_triangles), len(me.materials), len(me.uv_layers))
    print("  " * d + "%s [%s] loc=%s%s" % (o.name, o.type, tuple(round(x, 3) for x in o.location), extra))
    for c in o.children:
        tree(c, d + 1)


for o in bpy.data.objects:
    if o.parent is None:
        tree(o)
tot = 0
for o in bpy.data.objects:
    if o.type == "MESH":
        o.data.calc_loop_triangles()
        tot += len(o.data.loop_triangles)
print("TOTAL TRIS", tot, "materials", len(bpy.data.materials))
print("MATS", sorted(m.name for m in bpy.data.materials))

sc = bpy.context.scene
for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
    try:
        sc.render.engine = eng
        break
    except Exception:
        pass
sc.render.resolution_x, sc.render.resolution_y = 960, 600
sc.render.image_settings.file_format = "PNG"
try:
    sc.eevee.taa_render_samples = 24
except Exception:
    pass
w = bpy.data.worlds.new("w")
sc.world = w
w.use_nodes = True
bg = w.node_tree.nodes["Background"]
bg.inputs[0].default_value = (0.55, 0.65, 0.8, 1)
bg.inputs[1].default_value = 1.0
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(30))
sc.collection.objects.link(sun)
fill = bpy.data.objects.new("fill", bpy.data.lights.new("fill", "POINT"))
fill.data.energy = 150
fill.location = (0, 0.5, 1.9)
sc.collection.objects.link(fill)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
sc.collection.objects.link(cam)
sc.camera = cam
# ground
bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, -0.01))
gm = bpy.data.materials.new("gnd")
gm.diffuse_color = (0.25, 0.25, 0.25, 1)
bpy.context.object.data.materials.append(gm)


def look(loc, target, lens=35):
    cam.location = loc
    cam.data.lens = lens
    d = Vector(target) - Vector(loc)
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def render(name):
    sc.render.filepath = os.path.join(outdir, name + ".png")
    bpy.ops.render.render(write_still=True)
    print("rendered", name)


def gl2bl(v):
    return Vector((v[0], -v[2], v[1]))


def setrot(name, axis_gl, ang):
    o = bpy.data.objects.get(name)
    if not o:
        print("missing", name)
        return
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = Quaternion(gl2bl(axis_gl).normalized(), ang)


look((4.2, -5.6, 2.3), (0, 0.2, 0.9))
render("1_front34")
look((-4.2, 6.4, 2.6), (0, 0.2, 0.9))
render("2_rear34")
look((0, 0, 4.2), (0, 0.05, 0.5), lens=28)
cam.rotation_euler = (0, 0, 0)
render("2b_topdown")

pv = {p["name"]: p for p in man["pivots"]}
for n in ("Door_L_Pivot", "Door_R_Pivot", "Tailgate_Pivot", "PopTop_Pivot"):
    setrot(n, pv[n]["axis"], pv[n]["open"])
s = pv["Slider_Pivot"]
sl = bpy.data.objects.get("Slider_Pivot")
d = [s["out"][i] * s["out_dist"] + s["axis"][i] * s["open"] for i in range(3)]
sl.location = Vector(sl.location) + gl2bl(d)
look((-6.4, 0.6, 1.7), (0, 0.4, 1.0))
render("3_side_open")
look((4.6, 5.4, 2.4), (0, 1.0, 1.2))
render("3b_rear_open_left")
look((-4.2, 6.4, 2.6), (0, 0.4, 1.0))
render("3c_rear_open_right")
look((-2.4, -0.2, 1.3), (0.2, 0.3, 0.9), lens=24)
render("4_interior_slider")
print("VERIFY DONE")
