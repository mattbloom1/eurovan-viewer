# GLB export tools

Re-export for a new model version (e.g. v33). Never open or save the original .blend; work on a copy.

1. Copy the new .blend to a temp folder, e.g. `C:\Users\matth\eurovan-viewer-work\v33_copy.blend`.
2. Run (PowerShell, Blender 5.2, 4 threads, BelowNormal priority):

```
powershell -File C:\Users\matth\eurovan-viewer\tools\run.ps1 -Blend C:\Users\matth\eurovan-viewer-work\v33_copy.blend -Version v33 -Log C:\Users\matth\eurovan-viewer-work\exp.log
```

   This runs `blender -b <blend> -t 4 --python export_glb.py -- assets\van.glb assets\manifest.json --version v33`
   (about 2-7 minutes, mostly evaluating/decimating the body). The .blend is never saved.
3. Verify and render check images:

```
blender -b --factory-startup --python tools\verify.py -- assets\van.glb assets\manifest.json <outdir>
```

Notes: render-visible objects only (hide_render on object or any parent collection); pop-top lid parts are
listed in `LID_NAMES` in export_glb.py; decimation targets are in `target_for()`.
