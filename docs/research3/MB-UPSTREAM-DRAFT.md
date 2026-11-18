# DRAFT for the upstream issue (not posted; the lead decides)

Target: the cluster-render issue that says the KOMBI's black box over a full-panel client "cannot be investigated".
Written to be pasted as a comment. No car identity, no personal data, no photos (they would show the car's own
displays); numbers only. Everything below was measured on our side with the bench that models cluster-render's
protocol, except the two car observations, which are labelled.

---

**Two clients, same library, same car, same cluster-render: one gets the black box, the other never has. Here is
everything that differs between them on the socket.**

Setup: an iDrive 7 car with the 1920 × 720 cluster, cluster-render 0.5.12 from the Store, panel target (slot 0x203,
scene 0x010004f8, class 0 as configured by default; the slot table shows `slot 0x203 status 2: 0x10004f8 class 0 map 1`).
Two of our apps draw the whole panel through the same Node client (`cluster_render_client.js`) and the same drawing
engine; only one runs at a time.

Car observations (owner, not instrumented):
1. App A (a 6-dial style theme) shows the KOMBI's black box over the right dial's hub (about x 1406–1597, y 342–419)
   at times: not at start-up in P, but after something changed (photos: after P → D; the owner: after a switch); once
   there it stayed through our own re-layouts.
2. App B (two round dials) has not shown it since it was installed, in normal driving. Its speed readout sits inside
   that area (x 1417–1663, y 374–444), so a box would be obvious.
3. An older build of app A had, in one of its looks, fully transparent pixels over the gear letter but still one
   full-panel layer and one dial layer whose rectangles covered it; the box appeared in that look too (in D, after a
   start in P without it). That was on cluster-render 0.5.8, when the panel may have been on the fallback id.

What both apps send (traced message by message on the bench, three runs each, counts identical between runs):
- only `target: "panel"` layers and assets, every layer class `content`, no `exclusive`, `prewarm`, `contend` or
  `guide_hold`, three connections each (the app's own plus two for the 8-layers-per-connection cap);
- at start-up both build twice (a second full drop-and-make about 250 ms after the first);
- on a check-control message both drop every layer and make it again (A: 21 layers, B: 14);
- in a re-layout the target has no layer at all for at most 18 ms (A) / 3 ms (B), far inside `panel_linger_ms`
  (3000), so cluster-render never releases or re-maps the slot in either app. The slot id, content id, class and
  DCSM client id are cluster-render's own and the same for both.

What only A does:
1. **A layer rectangle over BMW's bottom-row gear letter (about x 1398–1424, y 668–703).** A has a full-panel effect
   layer (0, 0, 1920 × 720) and its right dial's effect layer (1173, 45, 670 × 670) over it, in every theme and
   state. B leaves x 1380–1460, y 660–720 free of any layer rectangle (its backdrop is three rectangles round it).
   Since every layer is a RAMSES quad scaled to its rectangle in the scene the KOMBI renders, the KOMBI does receive
   these rectangles as geometry, not only as pixels.
2. Under the letter A's pixels are opaque: dark grey (24, 24, 25) in one theme, near black (0–5) in the others.
   B's pixels there: none.
3. A re-makes all its layers on every drive-mode change (it changes theme with the mode): 15–21 layers, 0.8–5.8 MB
   of texture uploads and 36–55 KB of fragment shader source per switch. B changes nothing on a drive-mode change.
4. A is heavier overall: 21 layers vs 14, 11.4 MiB vs 4.7 MiB of pixel memory (cluster-render's accounting), the
   largest shader 13.3 KB vs 4.5 KB. Both are inside every limit; nothing is refused.

This matches the public reports that a theme leaving the gear letter's area free (as a gap in the layer geometry)
never gets the box, and that it appears and clears on KOMBI events (gear change, door) rather than on anything the
client does. What none of the reports separates (our observation 3 leans to the rectangle, but on an older setup),
and what we will test next, is whether the KOMBI reacts to a **rectangle** over the letter or to the **pixels** under
it: app B with one extra layer over the gap whose pixels
are fully transparent, then black, then grey; and app A with its rectangles cut round the gap and nothing else
changed (the picture outside the gap identical to the code).

Questions for anyone who knows the KOMBI side:
- Is anything known about a check of the composed picture around the PRND indicator (a region CRC or compare),
  which would explain a fallback of the gear indicator to its stock position (whose dark backing would be the box)?
- Does the KOMBI's renderer look at a client scene's geometry (bounding boxes of its meshes) for its own layout?

We will post the outcome of the four variants here.
