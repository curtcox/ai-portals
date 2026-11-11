# Portals

An endless, hands-off flight through 471 generated 3D worlds in a browser. Each world ends in a portal that opens on the next one, and nothing is steered: it flies itself. Live at [portals-endless-worlds.netlify.app](https://portals-endless-worlds.netlify.app) (press S for sound).

[![The Midwinter Express, one of the worlds of Portals: a steam train crosses a stone viaduct above a snowy town at dusk](readme/the-midwinter-express.jpg)](https://portals-endless-worlds.netlify.app)

This repository is the code behind that site as of November 9, 2026: release s8f, 471 worlds, about 1.4 million lines of JavaScript, designed and written by AI agents apart from the three.js library and some short borrowed functions (credited at the end). It wants a real graphics card, though it runs on a phone or an older laptop at lower quality.

- **Everything is generated.** No world loads a 3D model, a texture image or a sound file. Each one builds its geometry and textures in the browser while the world before it is still flying, and synthesizes its own sound as it plays. The only image files here are the gallery's thumbnails, the site's icons and link preview, and the two screenshots on this page; no world loads any of them. (The nearest exception is the Utah teapot, which ships inside three.js as a list of numbers and stands on a table in a few worlds.)
- **Two worlds run at once,** the one on screen and the one behind the portal, so a crossing has no cut and no fade.
- **Static site, no backend.** three.js is the only library the site loads, and what the build produces is plain static files. Nothing leaves the browser: no account, no server, no tracking. Worlds seen, favorites and settings are kept in the browser's own storage.

## Quick start

[Node](https://nodejs.org) 18 or later, and nothing else.

```
git clone https://github.com/emollick/ai-portals.git
cd ai-portals
npm start
```

That serves the source as it stands at http://localhost:8000, with nothing to install or build first. (From source the gallery can't mark which worlds are new or offer its page of descriptions, and the first time you open it the browser's console shows one missing file, `atlas.json`, which only the build writes.)

To make the package that gets deployed:

```
npm install
npm run build
npm run preview
```

The result is in `dist`, plain static files that any web host can serve, and the preview is at http://localhost:8001. Every script the project wrote is minified with esbuild, and the build adds the pieces that exist only on a deployed site: a small page for each world and journey so that shared links show a preview, a plain page that lists every world with its description, the gallery's record of which worlds are new, and the host's settings file. Each release has a short name, and this one is s8f. Run as `npm run build -- --stamp s8f`, this tree came out identical to the live site, file for file and byte for byte, on November 9, 2026. The site may have grown since.

## Making a video

`tools/render-video.mjs` renders a flight into video files. It needs [ffmpeg](https://ffmpeg.org) (with libx265, libx264, libsvtav1 and libopus) and Google Chrome, plus `npm install` for the library that drives Chrome.

```
npm install
npm run video                                   # the journey Grand, in 4K at 60 frames a second
npm run video -- --journey one-day
npm run video -- --worlds orbit-dawn,storm-bands,the-umbra
npm run video -- --count 8 --seed 42            # eight worlds as the picker would choose them
npm run video -- --size 1280x720 --seconds 20   # a quick test
npm run video -- --list                         # the journeys
npm run video -- --help                         # every option
```

The script draws the site in a headless Chrome one frame at a time, so the video is smooth however slowly the machine draws. Nothing is shown waiting for a world to load either: the script itself waits between frames while the next world builds. The sound is the site's own, made by the same code in an offline audio context that keeps time with the video. The on-screen bar and title cards are left out, and the picture fades in at the start and out into the last portal.

Each run writes four files to `video/`:

| File | What it is |
|---|---|
| `<name>-full.mov` | The master: H.265 10-bit at near-lossless quality, at the rendered size and rate, with 24-bit PCM sound. About 1.2 to 1.7 GB a minute at 4K. |
| `<name>-youtube.mp4` | For upload to YouTube: H.264 High, half-second closed GOPs, BT.709, at most 68 Mbit/s (YouTube's figure for 4K 60), AAC at 384 kbit/s, index at the front, a chapter for each world. |
| `<name>-min.mp4` | The smallest: AV1 at 720p and 30 frames a second, at most 1.5 Mbit/s, with Opus sound. It plays in browsers and VLC; QuickTime plays it only on Macs with AV1 hardware. |
| `<name>-chapters.txt` | When each world begins, ready to paste into a YouTube description. |

A 4K render is slow. On an Apple M1 it runs at about 4 frames a second (the graphics card is the limit), so a 10-minute journey takes around two and a half hours. On a Mac the master is encoded by the hardware HEVC encoder. `--encoder software` uses x265 instead, which gives a smaller file but runs about five times slower.

## Controls

| Key | What it does |
|---|---|
| Space | Pause |
| → | Hurry to the next portal |
| S | Sound on or off (it starts off) |
| G | Gentle: a steady camera and a level horizon, if the motion is too much |
| H | Keep this world as a favorite |
| P | Save a picture |
| I | The gallery: every world, the journeys, and a search box |
| O | Options: graphics, camera, art style, ride, companion, time of day |
| F | Fullscreen |

Move the mouse and a bar appears at the bottom of the screen with a button for each of these, and two sliders: Pace, and one that runs from Earthly to Strange (in a narrow window the sliders move into the options).

## Layout

```
index.html     the page
src/main.js    the page's wiring: keys, options, the bar
src/core       the engine: the flight, the portal, the picker, sound, graphics quality
src/kit        shared building blocks for worlds
src/worlds     one file per world, the list of them, and the hall every visit opens in
src/parts      the worlds' set pieces
src/extras.js  the list of rides, companions and art styles
src/rides, src/companions, src/styles
               the extras themselves
src/ui         the gallery, sharing, and ui.css, the page's only style sheet
vendor/three   three.js, the only library
thumbs         the gallery's thumbnails
design         two tables the build reads: each world's text, and the release it arrived in
icons, og.jpg, manifest.webmanifest
               the home-screen install and the picture a shared link shows
readme         the two screenshots on this page
tools          the build script, a small local server, and the video renderer
```

## How it works

**A world** is a file in `src/worlds` whose default export is an object with a `build` function, listed in `src/worlds/index.js` with its title, kind and caption; that list is what the gallery and the picker read. Nearly every world keeps its main set piece in a second file in `src/parts`. `build` returns a three.js scene, a camera path and a duration (most are 40 to 50 seconds), and the engine flies the camera along the path. A shared kit covers what many worlds need: skies, water, terrain, plants, animals, buildings, interiors.

**The portal.** About a second after each crossing the engine picks the next world, builds it a few milliseconds at a time between frames, and then warms up its shaders and textures out of sight, so that nothing is left to do in the frame that first shows it. What you see through the opening is that world itself, drawn into the opening on every frame by a second camera; just short of the gate the engine makes it the current world and keeps flying. If it isn't ready yet, the flight slows down and waits in front of the portal.

![A castle gate at the end of a snowy bridge. Through the gate, instead of a courtyard, a small green world floats in space.](readme/portal.jpg)

*The castle gate at the end of The Midwinter Express. On the other side, The World Turtle is already running.*

**Picking the next world.** Worlds you haven't seen come first, and for the first dozen worlds of a visit the picker keeps to the worlds the judging agents rated best. The Earthly to Strange slider sets how often the stranger worlds come up, and the picker leans toward a world unlike the one you're in: a different kind of place, lighter or darker, warmer or cooler.

**Sound.** Each world gets a slow chord and a few bells. Most also get a quiet bed (wind, water, room tone, or a still hum in space) and up to three layers out of nineteen (rain, surf, birds, a distant bell), all synthesized by the browser's audio engine.

**Graphics.** With graphics on Auto the site guesses a quality level from your graphics card, then raises and lowers the drawing resolution to keep the flight smooth.

## The worlds

The gallery (press I) sorts all 471: 64 wilderness, 49 cities, 40 bizarre, 35 oceans, 30 interiors, 26 skies, 26 at home, 26 alien and 15 prehistoric. Another 52 are original places in the manner of an artist or a work of the past (Hokusai, Vermeer, Escher, the Bayeux Tapestry), 60 are imagined from books, 7 are Wonders of the Ancient World, 26 come from film and television, and 15 are AI in-jokes. A world in the manner of an artist or an older work is marked "after" in the gallery, and one imagined from a book, a film or a series is marked "inspired by"; all of them are original places rather than copies of a scene.

There are also 20 journeys, which fly a set of worlds in order: [One Drop of Water](https://portals-endless-worlds.netlify.app/j/one-drop-of-water/) goes from a hailstone to the deep sea, [Zooming Out](https://portals-endless-worlds.netlify.app/j/zooming-out/) starts inside a living cell, and in [Seven Insides](https://portals-endless-worlds.netlify.app/j/seven-insides/) each world is inside something in the one before.

The worlds are uneven, and the agents' own grading says so. Every world carries a band from 1 to 5: 40 of the 471 are in band 5 and 28 in band 1. The bands are what the picker uses to decide which worlds a visit opens with.

## How it was built

Ethan Mollick described the idea in a paragraph in October 2026 and left the building to Claude; twenty hours later there were 204 worlds on a live website. By the tenth day there was a lead agent that owned the engine and shipped every release, and 28 teams of agents building worlds in parallel. Agents acting as judges scored the worlds, and those scores became the bands above. Before each release the lead agent's tools rendered every new world, and every world whose code had changed, at three points along its flight and checked the frames for errors and broken pixels; a world that failed was left out. Then they played the assembled site at ten times its normal speed before anything went live. Claude's own estimate, not a count, is that about 25,000 agents worked on the project. This README was written by Claude too, and other agents checked it against the code.

The comments in the code are the agents' notes to themselves and to each other, left as they were apart from a few short passages edited for this repository: lines that quoted or pointed at Ethan's messages, a few notes about the agents' own machines and working folders, and the first lines of three files that the release tooling writes. They have a dialect: the lead agent is "the owner" or "the site's owner," the teams are "crews," and a team's own head is its "lead" or "designer." So a line such as "the owner's ruling of 14 Oct" records one agent's note to another. Hundreds of comments also name screenshots, briefs, reviews and tools that aren't here, because this repository holds the site's code and leaves out the project's working files: `tools` keeps only the build script, edited for this repository, and a small local server and a video renderer written for it.

## License and credits

This repository is under the [Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International license](LICENSE) (CC BY-NC-SA 4.0): you can share it and build on it for non-commercial purposes, as long as you give credit and keep the same license. Some pieces keep terms of their own. [three.js](https://threejs.org) and a number of short functions are MIT-licensed, and [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt) lists the ones the agents traced as they worked.

A check made just before this repository was published found more borrowed functions than that file lists. The main ones: the water caustics in the shared water and plant code and in four worlds follow a Shadertoy shader by Dave Hoskins, which builds on a GLSL Sandbox effect by joltz0r. A three-line hash used in many worlds comes from Martijn Steinrucken's shader tutorials. Two noise routines follow scene shaders by Inigo Quilez, and a grid hash comes from a Stack Overflow answer. As far as the check could establish, the Shadertoy shaders among these were published under Creative Commons Attribution-NonCommercial-ShareAlike 3.0, which is why this repository carries that license in its current version. The Stack Overflow answer is share-alike without the non-commercial part (CC BY-SA 3.0), and the GLSL Sandbox effect states no terms. All of them remain their authors' work. On two points this paragraph differs from the notices file, which was written earlier: that file names no author for the three-line hash, and it lists one of the two noise routines as MIT. This paragraph is the later reading.

## Gallery

Fifteen of the 471. Each picture is the gallery's own thumbnail and opens that world on the live site; the site's gallery (press I) holds the rest.

<table>
<tr>
<td width="33%" valign="top"><a href="https://portals-endless-worlds.netlify.app/w/million-mirrors/"><img src="thumbs/million-mirrors.jpg" alt="Hall of a Million Mirrors" width="100%"></a><br><a href="https://portals-endless-worlds.netlify.app/w/million-mirrors/"><b>Hall of a Million Mirrors</b></a><br><sub>Interiors</sub></td>
<td width="33%" valign="top"><a href="https://portals-endless-worlds.netlify.app/w/marigold-way-home/"><img src="thumbs/marigold-way-home.jpg" alt="The Marigold Way Home" width="100%"></a><br><a href="https://portals-endless-worlds.netlify.app/w/marigold-way-home/"><b>The Marigold Way Home</b></a><br><sub>At home</sub></td>
<td width="33%" valign="top"><a href="https://portals-endless-worlds.netlify.app/w/thousand-kite-roofs/"><img src="thumbs/thousand-kite-roofs.jpg" alt="Kites at Uttarayan" width="100%"></a><br><a href="https://portals-endless-worlds.netlify.app/w/thousand-kite-roofs/"><b>Kites at Uttarayan</b></a><br><sub>Cities</sub></td>
</tr>
<tr>
<td width="33%" valign="top"><a href="https://portals-endless-worlds.netlify.app/w/storm-bands/"><img src="thumbs/storm-bands.jpg" alt="Living Balloons over a Gas Giant" width="100%"></a><br><a href="https://portals-endless-worlds.netlify.app/w/storm-bands/"><b>Living Balloons over a Gas Giant</b></a><br><sub>Alien</sub></td>
<td width="33%" valign="top"><a href="https://portals-endless-worlds.netlify.app/w/prismatic-dawn/"><img src="thumbs/prismatic-dawn.jpg" alt="Bison in the Coloured Steam" width="100%"></a><br><a href="https://portals-endless-worlds.netlify.app/w/prismatic-dawn/"><b>Bison in the Coloured Steam</b></a><br><sub>Wilderness</sub></td>
<td width="33%" valign="top"><a href="https://portals-endless-worlds.netlify.app/w/hanging-sea-lilies/"><img src="thumbs/hanging-sea-lilies.jpg" alt="The Hanging Meadow" width="100%"></a><br><a href="https://portals-endless-worlds.netlify.app/w/hanging-sea-lilies/"><b>The Hanging Meadow</b></a><br><sub>Prehistoric</sub></td>
</tr>
<tr>
<td width="33%" valign="top"><a href="https://portals-endless-worlds.netlify.app/w/the-turning-night/"><img src="thumbs/the-turning-night.jpg" alt="The Sky Drains into the Moon" width="100%"></a><br><a href="https://portals-endless-worlds.netlify.app/w/the-turning-night/"><b>The Sky Drains into the Moon</b></a><br><sub>after Vincent van Gogh</sub></td>
<td width="33%" valign="top"><a href="https://portals-endless-worlds.netlify.app/w/stairway-everywhere/"><img src="thumbs/stairway-everywhere.jpg" alt="Stairway Everywhere" width="100%"></a><br><a href="https://portals-endless-worlds.netlify.app/w/stairway-everywhere/"><b>Stairway Everywhere</b></a><br><sub>after M. C. Escher</sub></td>
<td width="33%" valign="top"><a href="https://portals-endless-worlds.netlify.app/w/litho-medusae/"><img src="thumbs/litho-medusae.jpg" alt="A Page of Jellyfish" width="100%"></a><br><a href="https://portals-endless-worlds.netlify.app/w/litho-medusae/"><b>A Page of Jellyfish</b></a><br><sub>after Ernst Haeckel</sub></td>
</tr>
<tr>
<td width="33%" valign="top"><a href="https://portals-endless-worlds.netlify.app/w/carnival-on-the-frozen-river/"><img src="thumbs/carnival-on-the-frozen-river.jpg" alt="Carnival on the Frozen River" width="100%"></a><br><a href="https://portals-endless-worlds.netlify.app/w/carnival-on-the-frozen-river/"><b>Carnival on the Frozen River</b></a><br><sub>inspired by <i>Orlando</i> by Virginia Woolf</sub></td>
<td width="33%" valign="top"><a href="https://portals-endless-worlds.netlify.app/w/pharos-of-alexandria/"><img src="thumbs/pharos-of-alexandria.jpg" alt="The Lighthouse of Alexandria" width="100%"></a><br><a href="https://portals-endless-worlds.netlify.app/w/pharos-of-alexandria/"><b>The Lighthouse of Alexandria</b></a><br><sub>a Wonder of the Ancient World</sub></td>
<td width="33%" valign="top"><a href="https://portals-endless-worlds.netlify.app/w/pelican-peloton/"><img src="thumbs/pelican-peloton.jpg" alt="The Pelican Peloton" width="100%"></a><br><a href="https://portals-endless-worlds.netlify.app/w/pelican-peloton/"><b>The Pelican Peloton</b></a><br><sub>AI in-jokes</sub></td>
</tr>
<tr>
<td width="33%" valign="top"><a href="https://portals-endless-worlds.netlify.app/w/orbit-dawn/"><img src="thumbs/orbit-dawn.jpg" alt="Orbital Sunrise" width="100%"></a><br><a href="https://portals-endless-worlds.netlify.app/w/orbit-dawn/"><b>Orbital Sunrise</b></a><br><sub>Skies</sub></td>
<td width="33%" valign="top"><a href="https://portals-endless-worlds.netlify.app/w/atoll-pass-shark-wall/"><img src="thumbs/atoll-pass-shark-wall.jpg" alt="Shark Pass" width="100%"></a><br><a href="https://portals-endless-worlds.netlify.app/w/atoll-pass-shark-wall/"><b>Shark Pass</b></a><br><sub>Oceans</sub></td>
<td width="33%" valign="top"><a href="https://portals-endless-worlds.netlify.app/w/sun-in-the-antlers/"><img src="thumbs/sun-in-the-antlers.jpg" alt="The Elk Who Carries the Sun" width="100%"></a><br><a href="https://portals-endless-worlds.netlify.app/w/sun-in-the-antlers/"><b>The Elk Who Carries the Sun</b></a><br><sub>Bizarre</sub></td>
</tr>
</table>
