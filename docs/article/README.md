# The article: how to publish

Files here (the working copy, intermediate renders and revision 3 stay in the git-ignored `bake/work/article/`):

- `article.uk.md`: the lead version, Ukrainian, for DOU (revision 4).
- `article.en.md`: the English adaptation (Habr in English, a blog, Medium) (revision 4).
- `CHANGES-r4.md`: what changed in revision 4 and why.
- `images/`: every picture the texts use. Pictures with text come in two languages (`*_uk.png`, `*_en.png`); the
  renders (`hero-*.png`) serve both.
- `sources.md`: where each fact and number comes from (file, line, commit, report). Keep it next to the draft for
  review; it is not for publication. The section "Revision 4" covers everything new.
- `src/`: the scripts that made the images.
- `render/` (only in `bake/work/article/`): intermediate frames and contact sheets (not for publication).

## Before publishing

1. The texts are impersonal (a technical paper's register) and carry no byline. The human / AI-agent split is stated
   once in "Коротко" / "In short". Add a link to the repository only if it should be public under a name: the article
   names no account.
2. Fill the one placeholder in section 3 ("Чорний прямокутник" / "The black box"): `[МЕХАНІЗМ: уточнити]` /
   `[MECHANISM: to confirm]`, which diagnostic experiment hid the black box on the car.
3. Read `sources.md` once and check the facts marked there as the owner's statements or estimates.
4. Look at every picture at full size. They are bench renders, the project's diagrams and pictures made from the
   apps' own baked files, plus two pictures with the owner's own photos of the G20 panel (`photos-early_*.png`,
   `rectify_*.png`), cropped to the cluster with the map, the street name and the town name blurred. Check those two
   yourself. No profile picture, no personal text. The f30 frames carry the bench's invented clock and temperature;
   the Twin Dial frames carry the gallery's invented trip, radio station and messages, and a test-fixture odometer
   value (48 215 km).

## DOU (Ukrainian)

DOU's editor takes Markdown-like text: paste the body, then upload each image where its `![...](images/...)` line is,
and put the italic line under it as the caption. Tables: if the editor does not keep Markdown tables, paste them as
plain lines or use an image. Code blocks: use the editor's code block button (GLSL, JS, Python and JSON snippets).

Image order in `article.uk.md` (new in revision 4 marked *):

1. `hero-both.png` (lead)
2. `diagram-layer-stack_uk.png`
3. `photos-early_uk.png`
4. `diagram-zones_uk.png`
5. `rectify_uk.png` *
6. `dial-elements_uk.png` *
7. `layers-exploded_uk.png` *
8. `shading_uk.png` *
9. `masks-glyphs_uk.png` *
10. `evolution-f30_uk.png`
11. `diagram-probe-menu_uk.png`
12. `diagram-signal-path_uk.png`
13. `hero-twin.png`
14. `twin-mockup-vs-app_uk.png`
15. `twin-r8-face_uk.png` *
16. `diagram-message-safety_uk.png`
17. `states_uk.png`

The English text uses the same order with the `_en` files.

## Habr and others (English)

Habr's editor accepts Markdown (and its own WYSIWYG): upload the `_en` pictures in the same places. `hero-f30.png`
is an extra single shot of f30_cluster for a cover image or a social card (2000 × 822).

## Re-making the images

From the repository root, with the repo's uv cache:

```sh
UV="env UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy --with pillow python -I"
A=bake/work/article
F30=bake/work/shots/20261118-2239/C-scenarios/comfort/02-motorway-130-nopass.png
TW=bake/work/shots/twin-20261118-0.1.1/E/limit_50_cruise_60.ours.png
$UV $A/src/previews_history.py . $A/render/previews
(cd $A/src && $UV compose.py ../../../.. ../images compose.json)
$UV $A/src/diagrams.py . $A/images $F30 $TW
$UV $A/src/photos.py . $A/images $F30
# revision 4
$UV $A/src/r4_dial.py . $A/images $F30        # dial-elements_*, shading_*
$UV $A/src/r4_layers.py . $A/images $F30      # layers-exploded_*
$UV $A/src/r4_twin.py . $A/images             # twin-r8-face_*
$UV $A/src/r4_rectify.py . $A/images          # rectify_* (needs bake/work/overlay/rect/ from tools/overlay/rectify.py)
$UV $A/src/r4_masks.py . $A/images            # masks-glyphs_*
```

The scripts pass the repository root as the first argument; `r4_dial.py` imports `bake/src/C1` and `r4_twin.py`
imports `tools/twin-dial/face_shade.py` read-only (no bytecode is written there). `compose.json` names the source
frames relative to the repository root.

## Byline (optional)

If the publication needs an author line, add it at the top: `[Автор]` / `[Author]`.
