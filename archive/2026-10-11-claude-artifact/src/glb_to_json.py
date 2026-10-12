"""Convert the Blender GLB into a .gltf JSON with an embedded buffer (the artifact host serves JSON, not .glb).
usage: python3 glb_to_json.py in.glb out.gltf.json"""
import json, struct, base64, sys
src, dst = sys.argv[1], sys.argv[2]
b = open(src, 'rb').read()
l = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20+l])
off = 20 + l; bl = struct.unpack('<I', b[off:off+4])[0]; binc = b[off+8:off+8+bl]
j['buffers'][0]['uri'] = 'data:application/octet-stream;base64,' + base64.b64encode(binc).decode()
json.dump(j, open(dst, 'w'), separators=(',', ':'))
