import json
import pathlib
import sys
import bpy

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from export_asset import export_all

if not bpy.data.filepath:
    raise RuntimeError('Open the saved kvb-table.blend before exporting')
output = pathlib.Path(bpy.data.filepath).parent
table = bpy.data.collections.get('COL_Table')
pockets = [group for group in bpy.data.collections if group.name.startswith('COL_Pocket_')]
cue = bpy.data.objects.get('SM_Cue')
if not table or len(pockets) != 6 or not cue:
    raise RuntimeError('Expected COL_Table, six COL_Pocket_* collections and SM_Cue')
export_all(output, table, pockets, cue, json.loads(bpy.context.scene['geometry']))
print('KVB_REEXPORT_COMPLETE; source blend preserved')
