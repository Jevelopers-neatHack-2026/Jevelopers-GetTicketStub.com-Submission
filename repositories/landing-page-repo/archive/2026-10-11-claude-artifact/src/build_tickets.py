"""
ticketstub.com — Blender build for the stub asset and every flight on the page.

Run headless:  python3 build_tickets.py        (pip package `bpy`, Blender 5.x)

Outputs (../site/assets):
  * ticketstub.glb   — one stub mesh (die-cut outline, perforation notches, real card thickness,
                       front/back/edge materials, 5 flex shape keys), the corkboard, its mitred frame,
                       a push pin, and one animated object per flight:
      S0..S7    : the showcase throws, one per event scene (performer's hand -> past the camera)
      B00..Bnn  : the landscape wall — 5 heroes land one by one, the rest arrive all at once
      P00..Pnn  : the same idea on a portrait wall for phones
  * flight.json      — metadata (slots, landing frames, pin spots, timings) and the per-frame
                       shape-key weights for every flight (the page drives morph weights from it)

Physics: every flight is integrated as a rigid 300 gsm card (15 cm x 5.5 cm, 2.5 g) with a
quasi-steady flat-plate aerodynamic model — normal-force drag that depends on the angle of attack,
skin friction, a centre-of-pressure torque that makes the card weathervane broadside and flutter,
and rotational damping. A Newton shooting method finds the launch velocity that makes each card
hit its target, then the result is keyed into the Blender timeline in slow motion. Paper flex is
driven by the aerodynamic load history through damped oscillators (card stock is stiff, so the
load-to-flex mapping is normalised rather than solved as a plate-bending FEM).
"""
import bpy, bmesh, math, os, json, random
import numpy as np
from mathutils import Matrix, Quaternion

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "site", "assets"))
os.makedirs(OUT, exist_ok=True)

# ----------------------------------------------------------------------------- constants
FPS = 30
L, W = 3.0, 1.1            # stub size in scene units (three.js coords: x right, y up, z to camera)
XP = 0.88                  # perforation line (x), the tear-off stub is x > XP
THICK = 0.007              # card thickness in scene units
UNIT = 0.05                # metres per scene unit  -> 15 cm x 5.5 cm card
GSM = 0.300                # kg / m^2
RHO = 1.2                  # air density
G = 9.81
BOARD_W, BOARD_H = 16.0, 10.0
FRAME_W = 0.8              # frame moulding width  -> outer 17.6 x 11.6
NX, NY = 49, 17            # stub grid
SCENE_BLOCK, THROW_FR = 120, 100

L_M, W_M = L * UNIT, W * UNIT
AREA = L_M * W_M
MASS = GSM * AREA
INERTIA = np.array([MASS * W_M ** 2 / 12, MASS * L_M ** 2 / 12, MASS * (L_M ** 2 + W_M ** 2) / 12])

for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob, do_unlink=True)
scene = bpy.context.scene
scene.render.fps = FPS

# ----------------------------------------------------------------------------- coordinate helpers
# three.js (x, y, z)  ->  Blender (x, -z, y)   (the glTF exporter converts back with export_yup)
C = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], float)

def t2b(p):
    return (p[0], -p[2], p[1])

def q_mul(a, b):
    w1, x1, y1, z1 = a; w2, x2, y2, z2 = b
    return np.array([w1*w2 - x1*x2 - y1*y2 - z1*z2, w1*x2 + x1*w2 + y1*z2 - z1*y2,
                     w1*y2 - x1*z2 + y1*w2 + z1*x2, w1*z2 + x1*y2 - y1*x2 + z1*w2])

def q_norm(q):
    return q / np.linalg.norm(q)

def q_axis_angle(axis, ang):
    axis = np.asarray(axis, float); axis = axis / np.linalg.norm(axis)
    return np.array([math.cos(ang / 2), *(axis * math.sin(ang / 2))])

def q_to_mat(q):
    w, x, y, z = q
    return np.array([[1 - 2*(y*y + z*z), 2*(x*y - z*w), 2*(x*z + y*w)],
                     [2*(x*y + z*w), 1 - 2*(x*x + z*z), 2*(y*z - x*w)],
                     [2*(x*z - y*w), 2*(y*z + x*w), 1 - 2*(x*x + y*y)]])

def mat_to_q(m):
    return np.array(Matrix(m.tolist()).to_quaternion()[:])

def q_from_axes(xdir, zdir):
    """Rotation whose local x points along xdir and local z (the printed face) toward zdir."""
    z = np.asarray(zdir, float); z /= np.linalg.norm(z)
    x = np.asarray(xdir, float); x = x - z * x.dot(z); x /= np.linalg.norm(x)
    y = np.cross(z, x)
    return mat_to_q(np.stack([x, y, z], 1))

def slerp(a, b, t):
    if a.dot(b) < 0: b = -b
    d = min(1.0, float(a.dot(b)))
    if d > 0.9995: return q_norm(a + (b - a) * t)
    th = math.acos(d)
    return (math.sin((1 - t) * th) * a + math.sin(t * th) * b) / math.sin(th)

def q_t2b(q):
    return mat_to_q(C @ q_to_mat(q) @ C.T)

def smooth(t):
    t = min(1.0, max(0.0, t)); return t * t * (3 - 2 * t)

# ----------------------------------------------------------------------------- stub outline
RC, RN = 0.08, 0.075       # corner radius, perforation notch radius

def inset(x):
    d = 0.0
    ax = abs(x)
    if ax > L / 2 - RC:
        dx = ax - (L / 2 - RC); d = max(d, RC - math.sqrt(max(0.0, RC * RC - dx * dx)))
    if abs(x - XP) < RN:
        d = max(d, math.sqrt(max(0.0, RN * RN - (x - XP) ** 2)))
    return d

xs = np.linspace(-L / 2, L / 2, NX)
xs = np.sort(np.concatenate([xs, [XP - 0.02, XP, XP + 0.02]]))   # crisp perforation column
NX = len(xs)
mid = {}
for i, x in enumerate(xs):
    d = inset(x)
    for j, v in enumerate(np.linspace(-1, 1, NY)):
        mid[(i, j)] = np.array([x, v * (W / 2 - d)])

# ----------------------------------------------------------------------------- flex modes
def bent_along(x, kappa_fn, steps=200):
    """Position along a strip whose centreline curvature is kappa_fn(s); returns (X, Z)."""
    s = np.linspace(0, x, steps) if x != 0 else np.array([0.0])
    if len(s) < 2: return 0.0, 0.0
    k = np.array([kappa_fn(v) for v in s])
    th = np.concatenate([[0], np.cumsum((k[1:] + k[:-1]) / 2 * np.diff(s))])
    X = np.trapezoid(np.cos(th), s); Z = np.trapezoid(np.sin(th), s)
    return X, Z

def deform(mode, x, y):
    if mode == "bendL":        # the whole card bows along its length (pressure on the face)
        X, Z = bent_along(x, lambda s: 0.45 * (1 if s >= 0 else -1) * 1.0)
        return np.array([X, y, abs(Z)])
    if mode == "bendW":        # cupping across the width
        k = 1.1; return np.array([x, math.sin(k * y) / k, (1 - math.cos(k * y)) / k])
    if mode == "twist":        # torsion about the long axis
        th = 0.75 * x / (L / 2); return np.array([x, y * math.cos(th), y * math.sin(th)])
    if mode == "wave":         # flutter mode, one and a half waves
        return np.array([x, y, 0.13 * math.sin(2 * math.pi * x / L * 1.5)])
    if mode == "stub":         # the tear-off stub flexes at the perforation (smooth, never a crease)
        if x <= XP - 0.18: return np.array([x, y, 0.0])
        x0 = XP - 0.18
        X, Z = bent_along(x - x0, lambda s: 1.6 * math.exp(-((s - 0.18) / 0.12) ** 2))
        return np.array([x0 + X, y, Z])
    raise ValueError(mode)

def deformed_vertex(mode, x, y, zoff):
    P = deform(mode, x, y)
    e = 1e-3
    dx = deform(mode, x + e, y) - deform(mode, x - e, y)
    dy = deform(mode, x, y + e) - deform(mode, x, y - e)
    n = np.cross(dx, dy); n /= np.linalg.norm(n)
    return P + n * zoff

MODES = ["bendL", "bendW", "twist", "wave", "stub"]

# ----------------------------------------------------------------------------- materials
def make_mat(name, rgb, rough):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    if b:
        b.inputs["Base Color"].default_value = (*rgb, 1)
        b.inputs["Roughness"].default_value = rough
    m.use_backface_culling = True
    return m

# ----------------------------------------------------------------------------- ticket mesh
def build_ticket():
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")
    rest = []
    front, back = {}, {}
    for key, (x, y) in mid.items():
        for store, z in ((front, THICK / 2), (back, -THICK / 2)):
            store[key] = bm.verts.new(t2b((x, y, z)))
            rest.append((key, z))
    bm.verts.ensure_lookup_table()

    def uv_of(key, flip):
        x, y = mid[key]
        u = (x + L / 2) / L
        return ((1 - u) if flip else u, (y + W / 2) / W)

    for i in range(NX - 1):
        for j in range(NY - 1):
            ks = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
            f = bm.faces.new([front[k] for k in ks]); f.material_index = 0; f.smooth = True
            for loop, k in zip(f.loops, ks): loop[uv_layer].uv = uv_of(k, False)
            f = bm.faces.new([back[k] for k in reversed(ks)]); f.material_index = 1; f.smooth = True
            for loop, k in zip(f.loops, list(reversed(ks))): loop[uv_layer].uv = uv_of(k, True)
    ring = [(i, 0) for i in range(NX)] + [(NX - 1, j) for j in range(1, NY)] + \
           [(i, NY - 1) for i in range(NX - 2, -1, -1)] + [(0, j) for j in range(NY - 2, 0, -1)]
    for a in range(len(ring)):
        k1, k2 = ring[a], ring[(a + 1) % len(ring)]
        f = bm.faces.new([front[k1], back[k1], back[k2], front[k2]])
        f.material_index = 2; f.smooth = False
        for loop in f.loops: loop[uv_layer].uv = (0.5, 0.5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("Ticket")
    bm.to_mesh(me); bm.free()
    me.materials.append(make_mat("TicketFront", (0.95, 0.92, 0.85), 0.62))
    me.materials.append(make_mat("TicketBack", (0.93, 0.9, 0.84), 0.75))
    me.materials.append(make_mat("TicketEdge", (0.86, 0.82, 0.74), 0.9))
    obj = bpy.data.objects.new("Ticket", me)
    scene.collection.objects.link(obj)
    obj.shape_key_add(name="Basis", from_mix=False)
    keys = list(mid.keys())
    for mode in MODES:
        sk = obj.shape_key_add(name=mode, from_mix=False)
        sk.value = 0.0
        cache = {}
        for vi, (key, z) in enumerate(rest):
            x, y = mid[key]
            sk.data[vi].co = t2b(deformed_vertex(mode, x, y, z))
    return obj

ticket = build_ticket()

# ----------------------------------------------------------------------------- corkboard, frame, pin
def build_board():
    hw, hh = BOARD_W / 2, BOARD_H / 2
    # cork slab (top face at z = 0)
    bm = bmesh.new(); uv = bm.loops.layers.uv.new("UVMap")
    v = [bm.verts.new(t2b(p)) for p in [(-hw, -hh, 0), (hw, -hh, 0), (hw, hh, 0), (-hw, hh, 0)]]
    f = bm.faces.new(v)
    for loop in f.loops:
        co = loop.vert.co; loop[uv].uv = ((co.x + hw) / BOARD_W, (co.z + hh) / BOARD_H)
    me = bpy.data.meshes.new("Cork"); bm.to_mesh(me); bm.free()
    me.materials.append(make_mat("Cork", (0.69, 0.5, 0.31), 0.95))
    cork = bpy.data.objects.new("Cork", me); scene.collection.objects.link(cork)

    # frame: four mitred moulding bars (trapezoids meet on the diagonals, so the corners close)
    bm = bmesh.new(); uv = bm.loops.layers.uv.new("UVMap")
    ox, oy, top, lip, bot = hw + FRAME_W, hh + FRAME_W, 0.34, 0.26, -0.18
    sides = [  # inner edge a->b, outer edge B->A, grain direction
        ((-hw, -hh), (hw, -hh), (ox, -oy), (-ox, -oy), 0),
        ((hw, -hh), (hw, hh), (ox, oy), (ox, -oy), 1),
        ((hw, hh), (-hw, hh), (-ox, oy), (ox, oy), 0),
        ((-hw, hh), (-hw, -hh), (-ox, -oy), (-ox, oy), 1),
    ]
    def quad(pts, grain):
        vs = [bm.verts.new(t2b(p)) for p in pts]
        f = bm.faces.new(vs)
        for loop, p in zip(f.loops, pts):
            loop[uv].uv = ((p[0] if grain == 0 else p[1]) / 6.0, (p[1] if grain == 0 else p[0]) / 6.0 + p[2] * 0.4)
        return f
    for a, b, B, A, grain in sides:
        # rounded-ish profile: inner lip -> top -> outer face
        ai = (a[0] * 1, a[1] * 1)
        mid_a = (a[0] + (A[0] - a[0]) * .25, a[1] + (A[1] - a[1]) * .25)
        mid_b = (b[0] + (B[0] - b[0]) * .25, b[1] + (B[1] - b[1]) * .25)
        quad([(a[0], a[1], 0.0), (b[0], b[1], 0.0), (b[0], b[1], lip), (a[0], a[1], lip)], grain)          # inner wall
        quad([(a[0], a[1], lip), (b[0], b[1], lip), (mid_b[0], mid_b[1], top), (mid_a[0], mid_a[1], top)], grain)
        quad([(mid_a[0], mid_a[1], top), (mid_b[0], mid_b[1], top), (B[0], B[1], top - 0.05), (A[0], A[1], top - 0.05)], grain)
        quad([(A[0], A[1], top - 0.05), (B[0], B[1], top - 0.05), (B[0], B[1], bot), (A[0], A[1], bot)], grain)  # outer face
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("Frame"); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = False
    me.materials.append(make_mat("Wood", (0.29, 0.17, 0.09), 0.45))
    frame = bpy.data.objects.new("Frame", me); scene.collection.objects.link(frame)

    # push pin: needle, collar, domed head (origin at the cork surface)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=0.016, radius2=0.012, depth=0.16,
                          matrix=Matrix.Translation((0, 0, 0.0)))
    bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=0.085, radius2=0.1, depth=0.07,
                          matrix=Matrix.Translation((0, 0, 0.115)))
    bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=0.06, radius2=0.06, depth=0.08,
                          matrix=Matrix.Translation((0, 0, 0.19)))
    s = bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=0.15,
                                  matrix=Matrix.Translation((0, 0, 0.27)) @ Matrix.Diagonal((1, 1, 0.55, 1)))
    # the pin is modelled z-up in three coords: rotate into Blender's frame
    bmesh.ops.transform(bm, matrix=Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1))), verts=bm.verts)
    me = bpy.data.meshes.new("Pin"); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    me.materials.append(make_mat("PinPlastic", (0.85, 0.26, 0.17), 0.5))
    pin = bpy.data.objects.new("Pin", me); scene.collection.objects.link(pin)
    pin.location = t2b((0, 0, -40))
    return cork, frame, pin

cork, frame_obj, pin_obj = build_board()

# ----------------------------------------------------------------------------- flight physics
def aero(vel_m, q, w, wind_m):
    """Forces (world, N) and torques (body, N m) on the card. vel in m/s."""
    R = q_to_mat(q)
    n = R[:, 2]; xb = R[:, 0]
    v = vel_m - wind_m
    sp = np.linalg.norm(v) + 1e-9
    vn = v.dot(n)
    vt = v - vn * n
    sin_a = abs(vn) / sp
    cn = 2 * math.pi * sin_a / (1 + math.pi * sin_a / 2)         # flat-plate normal-force coefficient
    Fn = -0.5 * RHO * AREA * cn * sp * sp * math.copysign(1.0, vn) * n
    Ft = -0.5 * RHO * AREA * 0.06 * sp * vt
    F = Fn + Ft
    # centre of pressure sits ahead of the centroid (quarter chord at low angle of attack, centre
    # when broadside): the resulting torque weathervanes the card broadside and drives flutter
    vt_b = R.T @ vt
    vt_dir = vt_b[:2] / (np.linalg.norm(vt_b[:2]) + 1e-9)
    cp_off = 0.25 * (1 - sin_a)
    r_cp = np.array([vt_dir[0] * cp_off * L_M / 2, vt_dir[1] * cp_off * W_M / 2, 0.0])
    tau = np.cross(r_cp, R.T @ Fn)
    tau += -0.5 * RHO * np.array([W_M ** 4 * L_M, L_M ** 4 * W_M, (L_M ** 4 * W_M) * 0.3]) * 0.04 * np.abs(w) * w
    tau += -INERTIA * w * 0.6                                        # internal / viscous damping
    load = float((R.T @ Fn)[2])
    return F, tau, load

def simulate(p0_u, v0_m, q0, w0, T, wind=None, dt=1 / 600):
    wind = wind or (lambda t, p: np.zeros(3))
    p = np.asarray(p0_u, float) * UNIT; v = np.asarray(v0_m, float).copy()
    q = np.asarray(q0, float).copy(); w = np.asarray(w0, float).copy()
    out = [(0.0, p / UNIT, q.copy(), w.copy(), 0.0, 0.0)]
    t = 0.0
    n = int(round(T / dt))
    for _ in range(n):
        def deriv(p_, v_, q_, w_, t_):
            F, tau, load = aero(v_, q_, w_, wind(t_, p_ / UNIT) * UNIT)
            a = F / MASS + np.array([0, -G, 0])
            wd = (tau - np.cross(w_, INERTIA * w_)) / INERTIA
            qd = 0.5 * q_mul(q_, np.array([0, *w_]))
            return v_, a, qd, wd, load
        k1 = deriv(p, v, q, w, t)
        k2 = deriv(p + k1[0] * dt / 2, v + k1[1] * dt / 2, q_norm(q + k1[2] * dt / 2), w + k1[3] * dt / 2, t + dt / 2)
        k3 = deriv(p + k2[0] * dt / 2, v + k2[1] * dt / 2, q_norm(q + k2[2] * dt / 2), w + k2[3] * dt / 2, t + dt / 2)
        k4 = deriv(p + k3[0] * dt, v + k3[1] * dt, q_norm(q + k3[2] * dt), w + k3[3] * dt, t + dt)
        p = p + dt / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0])
        v = v + dt / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])
        q = q_norm(q + dt / 6 * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]))
        w = w + dt / 6 * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3])
        w = np.clip(w, -60, 60)
        t += dt
        sp = np.linalg.norm(v)
        out.append((t, p / UNIT, q.copy(), w.copy(), float(k1[4]), float(sp)))
    return out, v

def shoot(p0_u, target_u, T, q0, w0, wind=None):
    """Newton shooting on the launch velocity so the card arrives at the target after T seconds."""
    p0 = np.asarray(p0_u, float); tg = np.asarray(target_u, float)
    v = (tg - p0) * UNIT / T + np.array([0, 0.5 * G * T, 0])          # ballistic guess
    best = None
    for it in range(7):
        traj, _ = simulate(p0, v, q0, w0, T, wind)
        err = traj[-1][1] - tg
        e = np.linalg.norm(err)
        if best is None or e < best[0]: best = (e, v.copy(), traj)
        if e < 0.02: break
        J = np.zeros((3, 3)); h = 0.02
        for k in range(3):
            dv = np.zeros(3); dv[k] = h
            tk, _ = simulate(p0, v + dv, q0, w0, T, wind, dt=1 / 300)
            J[:, k] = (tk[-1][1] - traj[-1][1]) / h
        try:
            step = np.linalg.solve(J, -err)
        except np.linalg.LinAlgError:
            break
        v = v + np.clip(step, -3, 3) * 0.9
    return best

def flex_series(samples, frame_dt):
    """Aerodynamic load history -> damped-oscillator flex weights for the 5 shape keys."""
    loads = np.array([s[0] for s in samples]); spin = np.array([s[1] for s in samples]); flut = np.array([s[2] for s in samples])
    def norm(a, target=0.35):
        sc = np.percentile(np.abs(a), 92) + 1e-9
        return np.clip(a / sc * target, -1, 1)
    drive = np.stack([norm(loads), norm(loads, .15), norm(spin, .3), norm(flut, .25), norm(loads, .2)], 1)
    out = np.zeros_like(drive); x = np.zeros(5); v = np.zeros(5)
    wn = np.array([2.6, 3.4, 2.2, 3.9, 4.6]) * 2 * math.pi        # visual natural frequencies (slow-mo time)
    zeta = np.array([.32, .4, .28, .22, .3])
    for k in range(len(drive)):
        for _ in range(4):
            a = wn ** 2 * (drive[k] - x) - 2 * zeta * wn * v
            v += a * frame_dt / 4; x += v * frame_dt / 4
        out[k] = x
    return out

# ----------------------------------------------------------------------------- keying
weights_out = {}

def channelbag(obj):
    obj.keyframe_insert("location", frame=0)
    from bpy_extras import anim_utils
    ad = obj.animation_data
    ad.action.name = obj.name
    cb = anim_utils.action_get_channelbag_for_slot(ad.action, ad.action_slot)
    for fc in list(cb.fcurves): cb.fcurves.remove(fc)
    return cb

def key_object(name, frames, positions, quats, flex, visible_from, visible_to, hold_after=False):
    obj = bpy.data.objects.new(name, ticket.data)
    scene.collection.objects.link(obj)
    obj.rotation_mode = "QUATERNION"
    cb = channelbag(obj)
    fr = list(frames)
    loc = [t2b(p) for p in positions]
    rot = [q_t2b(q) for q in quats]
    scl = [1.0] * len(fr)
    # visibility via scale: 0 before the flight starts (and after it ends unless it stays pinned)
    kf = [visible_from - 1] + fr; loc = [loc[0]] + loc; rot = [rot[0]] + rot; scl = [0.0] + scl
    if not hold_after:
        kf += [visible_to + 1]; loc += [loc[-1]]; rot += [rot[-1]]; scl += [0.0]
    def put(path, idx, vals):
        fc = cb.fcurves.new(path, index=idx)
        fc.keyframe_points.add(len(kf))
        co = np.empty(2 * len(kf)); co[0::2] = kf; co[1::2] = vals
        fc.keyframe_points.foreach_set("co", co.tolist())
        fc.keyframe_points.foreach_set("interpolation", [1] * len(kf))    # LINEAR
        fc.update()
    for i in range(3): put("location", i, [l[i] for l in loc])
    for i in range(4): put("rotation_quaternion", i, [r[i] for r in rot])
    for i in range(3): put("scale", i, scl)
    obj.location = loc[0]; obj.scale = (0, 0, 0)
    weights_out[name] = dict(start=int(frames[0]), w=np.round(flex, 2).tolist())
    return obj

def run_flight(start, target, T, slowmo, q0, w0, q_land=None, settle=0.35, wind=None, impact=False):
    best = shoot(start, target, T, q0, w0, wind)
    err, v0, traj = best
    nf = int(round(slowmo * T * FPS)) + 1
    ts = np.array([s[0] for s in traj])
    pos, quats, samples = [], [], []
    endp = traj[-1][1]
    for k in range(nf):
        tk = T * k / (nf - 1)
        j = min(len(ts) - 2, int(np.searchsorted(ts, tk) - 1 if tk > 0 else 0)); j = max(j, 0)
        a = (tk - ts[j]) / max(ts[j + 1] - ts[j], 1e-9)
        p = traj[j][1] * (1 - a) + traj[j + 1][1] * a
        p = p + (np.asarray(target) - endp) * smooth(k / (nf - 1))       # absorb the last few mm of shooting error
        q = slerp(traj[j][2], traj[j + 1][2], a)
        if q_land is not None:                                           # the card settles flat as it meets the cork
            q = slerp(q, q_land, smooth((k / (nf - 1) - 0.62) / 0.38))
        w = traj[j][3]; load = traj[j][4]
        pos.append(p); quats.append(q); samples.append((load, w[0], w[1]))
    flex = flex_series(samples, 1 / FPS)
    if impact and q_land is not None:
        ns = int(settle * 40)
        for k in range(1, ns + 1):
            ring = math.exp(-k / (ns * 0.3)) * math.sin(k * 1.3)
            pos.append(np.asarray(target) + np.array([0, 0, 0.035 * ring]))
            quats.append(q_mul(q_land, q_axis_angle([1, 0, 0], 0.03 * ring)))
            flex = np.vstack([flex, np.array([0.18 * ring, 0.08 * ring, 0.0, 0.0, 0.25 * ring])])
        # fade the in-flight flex out over the last frames before contact
        for k in range(nf - 8, nf):
            flex[k] *= (nf - k) / 8
        # never let a tilted or flexing card dip into the cork on its way down: lift it by the
        # lowest corner (plus the flex sag) until it lies flat on the board
        corners = np.array([[sx * L / 2, sy * W / 2, 0.0] for sx in (-1, 1) for sy in (-1, 1)])
        tz = float(np.asarray(target)[2])
        for k in range(nf):
            R = q_to_mat(quats[k])
            low = float((corners @ R.T)[:, 2].min())
            sag = 0.16 * abs(flex[k][0]) + 0.12 * abs(flex[k][2]) + 0.1 * abs(flex[k][3]) + 0.12 * abs(flex[k][4])
            need = tz - low + sag + 0.01
            if pos[k][2] < need:
                pos[k] = pos[k].copy(); pos[k][2] = need
    return np.array(pos), quats, flex, v0

# ----------------------------------------------------------------------------- showcase throws
EVENTS = ["football", "baseball", "concert", "basketball", "soccer", "festival", "theater", "hockey"]
HAND_X = dict(football=-1.2, baseball=1.2, concert=-1.2, basketball=1.3, soccer=-3.5, festival=0.0, theater=-3.0, hockey=0.8)
HAND_Y = dict(football=2.1, baseball=1.8, concert=3.0, basketball=2.6, soccer=-0.4, festival=-1.0, theater=3.2, hockey=-3.2)
MODES_META = MODES
meta = dict(fps=FPS, board=[BOARD_W, BOARD_H], ticket=[L, W], modes=MODES_META, throws=[], heroes=[], swarm=[])
rng = random.Random(7)

def throw_score(quats, pos, start):
    s = 0.0
    for q, p in zip(quats, pos):
        R = q_to_mat(q)
        s += R[2, 2]                       # printed face toward the camera
        s += 0.6 * R[0, 0]                 # reads left-to-right (not upside down)
        s -= 0.4 * max(0.0, p[1] - start[1] - 1.5)
    return s / len(quats)

for i, ev in enumerate(EVENTS):
    side = -1 if i % 2 == 0 else 1
    start = np.array([HAND_X[ev], HAND_Y[ev], 2.2])
    target = np.array([-side * 7.2, -0.4 + rng.uniform(-0.3, 0.3), 3.5])   # exits the frame late in the scroll, not halfway
    T = 0.24
    best = None
    for att in range(12):
        q0 = q_from_axes(np.array([1.0, rng.uniform(-.25, .25), 0]), np.array([rng.uniform(-.3, .3), rng.uniform(-.2, .3), 1.0]))
        w0 = np.array([rng.uniform(-3, 3), rng.uniform(-3, 3), -side * rng.uniform(5, 10)])
        r = run_flight(start, target, T, THROW_FR / (T * FPS), q0, w0)
        sc = throw_score(r[1], r[0], start)
        if best is None or sc > best[0]: best = (sc, r)
    pos, quats, flex, v0 = best[1]
    # showcase throws are a fast release: the card visibly whips off the hand, then flutters
    flex = np.clip(flex * 2.0, -0.6, 0.6)
    tt = np.arange(len(flex)) / len(flex)
    whip = np.exp(-tt / 0.08) * np.cos(tt * 2 * math.pi * 4)
    flex[:, 0] += 0.45 * whip; flex[:, 4] += 0.4 * whip
    env = np.sin(np.clip((tt - 0.1) / 0.8, 0, 1) * math.pi)
    flex[:, 0] += 0.25 * env * np.sin(tt * 2 * math.pi * 2.6); flex[:, 2] += 0.22 * env * np.sin(tt * 2 * math.pi * 1.8 + 1.0)
    flex = np.clip(flex, -0.65, 0.65)
    f0 = i * SCENE_BLOCK
    frames = list(range(f0, f0 + len(pos)))
    key_object(f"S{i}", frames, pos, quats, flex, f0, frames[-1])
    meta["throws"].append(dict(name=f"S{i}", event=ev, side=side, start=start.tolist(),
                               frames=[f0, frames[-1]], v0=np.round(v0, 3).tolist()))
    print(f"throw {ev}: score {best[0]:.2f}, v0 {np.round(v0, 2)}")

# ----------------------------------------------------------------------------- the walls
from scipy import ndimage
BOARD_START = 1000
HERO_EVENTS = ["football", "baseball", "concert", "basketball", "hockey"]   # the five events with a thrown scene
HERO_STAGGER, HERO_FR = 96, 92
SWARM_START = BOARD_START + (len(HERO_EVENTS) - 1) * HERO_STAGGER + HERO_FR + 30

def land_quat(angle):
    return q_axis_angle([0, 0, 1], angle)

def gust(t, p):          # a shared swirl so the swarm moves like one gust of air
    return np.array([0.6 * math.sin(7 * t + p[1] * 9), 0.35 * math.cos(5 * t + p[0] * 7), 0.0])

def build_wall(prefix, BW, BH, hero_slots, seed):
    rng = random.Random(seed)
    hw, hh = BW / 2, BH / 2
    GX, GY = np.meshgrid(np.linspace(-hw, hw, int(BW * 20)), np.linspace(-hh, hh, int(BH * 20)))
    INNER = (np.abs(GX) < hw - .05) & (np.abs(GY) < hh - .05)
    def ticket_mask(x, y, a, pad=0.0):
        ca, sa = math.cos(-a), math.sin(-a)
        lx = (GX - x) * ca - (GY - y) * sa
        ly = (GX - x) * sa + (GY - y) * ca
        return (np.abs(lx) < L / 2 + pad) & (np.abs(ly) < W / 2 + pad)
    xmax, ymax = hw - 1.45, hh - 0.5
    slots = []
    rows = np.arange(-hh + 0.4, hh - 0.39, 0.84)
    for r, y in enumerate(rows):
        off = 1.22 if r % 2 else 0.0
        x = -hw + 0.9 + off
        while x < hw:
            slots.append((float(np.clip(x + rng.uniform(-0.18, 0.18), -xmax, xmax)), float(np.clip(y + rng.uniform(-0.1, 0.1), -ymax, ymax))))
            x += 2.45
    slots = [sl for sl in slots if not any(abs(sl[0] - hx) < 1.1 and abs(sl[1] - hy) < 0.45 for hx, hy in hero_slots)]
    rng.shuffle(slots)
    hero_angles = [rng.uniform(-0.16, 0.16) for _ in hero_slots]
    angles = [rng.uniform(-0.17, 0.17) for _ in slots]
    for y in np.arange(-hh + 1.7, hh - 1.69, 2.9):             # stubs turned on end along the side rails
        for sx in (-1, 1):
            slots.append((sx * (hw - 0.62), float(y))); angles.append(math.pi / 2 + rng.uniform(-0.06, 0.06))
    for _ in range(30):                                        # greedy gap filling until the cork is gone
        cov_m = np.zeros_like(GX, bool)
        for (x, y), a in zip(hero_slots + slots, hero_angles + angles):
            cov_m |= ticket_mask(x, y, a)
        if 1 - cov_m[INNER].mean() < 0.0015:
            break
        lab, k = ndimage.label(~cov_m & INNER)
        sizes = ndimage.sum(np.ones_like(GX), lab, range(1, k + 1))
        cy, cx = ndimage.center_of_mass(lab == int(np.argmax(sizes)) + 1)
        x = float(GX[0, int(cx)]); y = float(GY[int(cy), 0])
        if abs(x) > xmax - 0.3 and abs(y) < hh - 1.6:
            ang = math.pi / 2 + rng.uniform(-0.06, 0.06); x = float(np.clip(x, -(hw - 0.62), hw - 0.62)); y = float(np.clip(y, -(hh - 1.6), hh - 1.6))
        else:
            ang = rng.uniform(-0.12, 0.12); x = float(np.clip(x, -xmax, xmax)); y = float(np.clip(y, -ymax, ymax))
        slots.append((x, y)); angles.append(ang)
    cov_m = np.zeros_like(GX, bool)
    for (x, y), a in zip(hero_slots + slots, hero_angles + angles):
        cov_m |= ticket_mask(x, y, a)
    cov = float(cov_m[INNER].mean())
    print(f"{prefix} wall {BW}x{BH}: coverage {cov:.3%}, {len(hero_slots)} heroes + {len(slots)} swarm")

    heroes, swarm = [], []
    for i, ((x, y), a) in enumerate(zip(hero_slots, hero_angles)):
        side = -1 if i % 2 == 0 else 1
        start = np.array([side * rng.uniform(hw - 1, hw + 1), rng.uniform(-hh - 1, -hh + 0.5), rng.uniform(3, 4.5)])
        target = np.array([x, y, 0.09])
        T = 0.26
        best = None
        for att in range(6):
            # released face-on and upright, with a gentle roll: the print stays readable all the way in
            q0 = q_mul(land_quat(a + rng.uniform(-0.5, 0.5)), q_mul(q_axis_angle([1, 0, 0], rng.uniform(-0.35, 0.35)), q_axis_angle([0, 1, 0], rng.uniform(-0.35, 0.35))))
            w0 = np.array([rng.uniform(-2.5, 2.5), rng.uniform(-2.5, 2.5), rng.uniform(3, 7) * -side])
            r = run_flight(start, target, T, HERO_FR / (T * FPS), q0, w0, q_land=land_quat(a), impact=True)
            sc = sum(q_to_mat(q)[2, 2] + 0.6 * q_to_mat(q)[0, 0] for q in r[1]) / len(r[1])
            if best is None or sc > best[0]: best = (sc, r)
        pos, quats, flex, v0 = best[1]
        flex = np.clip(flex * 1.3, -0.35, 0.35); flex[:, 4] = np.clip(flex[:, 4], -0.12, 0.12)
        f0 = BOARD_START + i * HERO_STAGGER
        frames = list(range(f0, f0 + len(pos)))
        key_object(f"{prefix}{i:02d}", frames, pos, quats, flex, f0, frames[-1], hold_after=True)
        heroes.append(dict(name=f"{prefix}{i:02d}", event=HERO_EVENTS[i], slot=[x, y, 0.09], angle=a, land=f0 + HERO_FR, frames=[f0, frames[-1]], hero=True))
    layers = [(ticket_mask(hx, hy, ha, 0.02), 0) for (hx, hy), ha in zip(hero_slots, hero_angles)]
    for j, ((x, y), a) in enumerate(zip(slots, angles)):
        m = ticket_mask(x, y, a, pad=0.02)
        lay = max([pl + 1 for (pm, pl) in layers if (pm & m).any()] + [0])
        layers.append((m, lay))
        z = 0.006 + lay * 0.008
        ang = rng.uniform(0, 2 * math.pi); rad = rng.uniform(max(hw, hh) + 3, max(hw, hh) + 8)
        start = np.array([math.cos(ang) * rad, math.sin(ang) * rad * 0.7, rng.uniform(3, 6)])
        target = np.array([x, y, z])
        T = rng.uniform(0.2, 0.28); fr = int(rng.uniform(64, 84))
        vdir = target - start
        q0 = q_from_axes(np.array([vdir[0], vdir[1], 0.3]), np.array([rng.uniform(-.4, .4), rng.uniform(-.4, .4), 1.0]))
        w0 = np.array([rng.uniform(-6, 6), rng.uniform(-5, 5), rng.uniform(-16, 16)])
        pos, quats, flex, v0 = run_flight(start, target, T, fr / (T * FPS), q0, w0, q_land=land_quat(a), settle=0.3, wind=gust, impact=True)
        # 300 gsm card: it flicks and twists a little, it never curls or folds at the perforation
        flex[:, :2] = np.clip(flex[:, :2], -0.1, 0.1); flex[:, 2] = np.clip(flex[:, 2], -0.12, 0.12)
        flex[:, 3] *= 0.3; flex[:, 4] = np.clip(flex[:, 4], -0.04, 0.04)
        f0 = SWARM_START + int(rng.uniform(0, 34))
        frames = list(range(f0, f0 + len(pos)))
        nm = f"{prefix}{len(hero_slots) + j:02d}"
        key_object(nm, frames, pos, quats, flex, f0, frames[-1], hold_after=True)
        swarm.append(dict(name=nm, slot=[x, y, z], angle=a, land=f0 + fr, frames=[f0, frames[-1]]))
    # pins where no later stub will cover them; the showcase stubs always get theirs
    allb = heroes + swarm
    order = sorted(range(len(allb)), key=lambda k: allb[k]["land"])
    masks = [ticket_mask(b["slot"][0], b["slot"][1], b["angle"]) for b in allb]
    ny, nx = GX.shape
    for idx, k in enumerate(order):
        b = allb[k]
        if b.get("hero"):
            b["pin"] = [-1.25, 0.32]; continue
        later = np.zeros_like(GX, bool)
        for k2 in order[idx + 1:]:
            if allb[k2]["slot"][2] > b["slot"][2]:
                later |= masks[k2]
        b["pin"] = None
        for (px, py) in [(-1.25, 0.32), (-1.25, -0.32), (0.55, 0.42), (-0.4, 0.42)]:
            ca, sa = math.cos(b["angle"]), math.sin(b["angle"])
            wx, wy = b["slot"][0] + px * ca - py * sa, b["slot"][1] + px * sa + py * ca
            ix = int(round((wx + hw) / BW * (nx - 1))); iy = int(round((wy + hh) / BH * (ny - 1)))
            if 0 <= ix < nx and 0 <= iy < ny and not later[max(0, iy-2):iy+3, max(0, ix-2):ix+3].any():
                b["pin"] = [px, py]; break
    print(f"{prefix} pins visible:", sum(1 for b in allb if b["pin"]), "of", len(allb), " max layer:", max(l for _, l in layers))
    return heroes, swarm, cov

meta["heroes"], meta["swarm"], cov = build_wall("B", BOARD_W, BOARD_H,
    [(-4.6, 2.4), (0.7, 2.8), (5.2, 1.4), (-2.3, -1.4), (3.1, -2.5)], 10)
meta["heroesP"], meta["swarmP"], covP = build_wall("P", BOARD_H, BOARD_W,
    [(-1.9, 5.4), (1.8, 2.6), (-1.7, -0.3), (1.9, -3.1), (-1.6, -5.9)], 21)
END = max(m["frames"][1] for m in meta["swarm"] + meta["swarmP"]) + 10
scene.frame_start, scene.frame_end = 0, END
meta["frames"] = dict(scene_block=SCENE_BLOCK, throw=THROW_FR, board_start=BOARD_START,
                      hero_stagger=HERO_STAGGER, hero_flight=HERO_FR, swarm_start=SWARM_START, end=END)
meta["coverage"] = cov; meta["coverageP"] = covP
ticket.location = t2b((0, 0, -40))   # the source mesh object is parked (the page uses it for the hero spin)

# ----------------------------------------------------------------------------- export
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "ticketstub.blend"))
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT, "ticketstub.glb"), export_format="GLB", export_yup=True,
    export_animation_mode="ACTIONS", export_morph=True, export_morph_normal=False,
    export_force_sampling=False, export_optimize_animation_size=False, export_apply=False,
    export_materials="EXPORT", export_image_format="NONE", export_def_bones=False,
)
json.dump(dict(meta=meta, weights=weights_out), open(os.path.join(OUT, "flight.json"), "w"), separators=(",", ":"))
print("objects:", len(bpy.data.objects), "end frame:", END)
