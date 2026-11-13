# EuroVan Camper Configurator

An interactive 3D viewer and configurator for a 2003 VW EuroVan (T4) pop-top camper buildout,
built with three.js. Swap paint, cabinet wood, door colours, upholstery and flooring; toggle the
buildout and its parts; open the doors and the pop-top (with a generated canvas tent); switch
between day and night; and take the van for a drive around a parking lot.

Live site: <https://mattbloom1.github.io/eurovan-viewer/>

## Run locally

It is a static site with no build step. Serve the folder over HTTP (opening `index.html` directly
from disk will not work because ES modules and the model need HTTP):

```sh
npx serve .                    # or
python -m http.server 8123     # then open http://localhost:8123/
```

## Refresh the model

The model comes from the Blender file and is exported by `tools/export_glb.py`, which writes
`assets/van.glb` (Draco-compressed) and `assets/manifest.json`:

```sh
blender -b path/to/van.blend -t 4 --python tools/export_glb.py -- assets/van.glb assets/manifest.json --version v33
```

(`tools/run.ps1` wraps the same command on Windows.) Commit both files. The viewer reads the
manifest with `no-cache` and adds the export timestamp to the GLB URL, so browsers pick up a new
export without a hard refresh. The footer shows the model version and export date.

The viewer expects the node names and materials described in the export contract (`Van`, `Body`,
`Interior`, `Buildout/BO_*`, `Door_L_Pivot`, `Door_R_Pivot`, `Slider_Pivot`, `Tailgate_Pivot`,
`PopTop_Pivot`, `Wheel_FL/FR/RL/RR`, `VW_Paint`, `BO_BirchPly_Veneer`, ...). Anything missing is
logged to the browser console and skipped. Door motion and wheel data come from the manifest, and
built-in defaults are used when they are absent.

## Using it

- **Drag** to orbit, **scroll or pinch** to zoom, **right-drag or two-finger drag** to pan.
- **Tap a door**, the tailgate or the pop-top to open or close it.
- **Camera chips:** Exterior, Interior (opens the slider), Rear (opens the tailgate), Plan (top
  view with a section cut), and Driver.
- **Panel tabs:** Finishes, Parts (buildout, interior, x-ray, section cut), Open, Scene (time of
  day, lights, screenshot, share link, reset), and Drive.
- **Drive:** W/up arrow for gas, S/down arrow to brake and then reverse, A/D or the left/right
  arrows to steer, Space for the handbrake, C to change camera, R to reset, and Esc to exit. Phones
  get on-screen pedals and steering buttons.

Your configuration is saved in `localStorage` and in the URL hash (`#c=...`), so a link reproduces
the look.

Developer extras: `?model=path/to/other.glb` (and optionally `&manifest=...`) loads a different
model, and `window.__app` exposes the app object in the console.

## File layout

```
index.html            page shell + import map
css/style.css         UI styles (side panel on desktop, bottom sheet on phones)
src/main.js           renderer, loading, camera presets, tap-to-open, frame loop
src/config.js         palettes (paint, wood, upholstery, floors), names, defaults
src/finishes.js       material lookup and finish application, x-ray, light emissives
src/textures.js       procedural canvas textures (wood, ply edge, fabric, floor, tent)
src/openings.js       door/slider/tailgate/pop-top animation + pop-top tent mesh
src/environment.js    sky, sun/moon, day-night blending, ground, headlights, cabin lights
src/drive.js          drive world, arcade physics, chase/driver/orbit cameras, input
src/state.js          localStorage + URL-hash persistence
src/ui.js             panel construction
vendor/three/         three.js r187 (module build + addons + Draco decoder), MIT licence
assets/               van.glb + manifest.json (generated, do not edit by hand)
tools/                Blender export scripts
```
