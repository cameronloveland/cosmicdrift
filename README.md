COSMIC DRIFT (コズミック・ドリフト)
===================================

Playable Three.js prototype: neon space racing vibe with spline track, boost, flow meter, post-processing, and a chase camera.

Quickstart
----------

1. Install Node 18+.
2. Install deps:

```
npm install
```

3. Start dev server:

```
npm run dev
```

4. Build / preview:

```
npm run build
npm run preview
```

Controls
--------

- A/D or ← →: steer (turn)
- W/S or ↑ ↓: throttle / brake
- Shift: hold to drift
- Space: hold to boost, press to start

Extras
------
- E: draft lock-on (when eligible)

HUD
---

- Speed (km/h)
- Flow Meter (fills with smooth high-speed; drains off-track/erratic)
- Lap 1/3 (placeholder)

Assets
------

Place placeholder audio/textures under `public/`:

- `public/audio/bgm.mp3` — loopable synthwave track
- `public/audio/boost.wav` — short boost whoosh
- `public/audio/wind.wav` — loopable wind hiss
- `public/textures/star.png` and `public/textures/nebula.png` — optional sprites

Notes
-----

- Bloom + aberration used for cinematic glow; motion streaks suggested via trail and camera shake. You can substitute or add a motion blur pass.
- Fixed timestep update; modules are decoupled for future ghost/multiplayer.

# COSMIC DRIFT 

