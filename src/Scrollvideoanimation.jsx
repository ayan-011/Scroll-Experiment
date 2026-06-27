"use client";

/**
 * ScrollVideoAnimation — Ultra-smooth Apple-style scroll-driven video scrubbing
 *
 * What makes this smooth:
 *   1. CONTINUOUS rAF loop   — runs every frame (60fps), never waits for scroll events
 *   2. LERP (linear interp)  — currentTime glides toward target, never jumps
 *   3. CANVAS compositing    — video draws to <canvas> via drawImage(), bypassing
 *                              the browser's own video decode/paint pipeline which
 *                              causes the visible "stutter" on raw <video> seeks
 *   4. VELOCITY DAMPING      — scroll velocity is smoothed so fast flicks don't skip
 *   5. DEAD-ZONE skip        — skips drawImage when delta < 1 video frame to save GPU
 *
 * Usage (Next.js App Router):
 *   1. npm install gsap
 *   2. Place your video at /public/product.mp4 (or pass `src` prop)
 *   3. <ScrollVideoAnimation src="/product.mp4" />
 *
 * Props:
 *   src          – video URL (default: "/product.mp4")
 *   overlays     – { start, end, heading, body }[]  (scroll 0–1 progress)
 *   scrollHeight – total scroll distance in px (default: 5000)
 *   lerpFactor   – smoothing speed 0.01 (ultra slow) → 1 (instant). Default: 0.12
 */

import { useEffect, useRef } from "react";

// ─── Design tokens ────────────────────────────────────────────────────────────
const FONT_DISPLAY =
  "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', sans-serif";
const FONT_BODY =
  "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif";

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
  wrapper: {
    position: "relative",
    // height injected via CSS var at runtime
  },
  sticky: {
    position: "sticky",
    top: 0,
    height: "100vh",
    width: "100%",
    overflow: "hidden",
    backgroundColor: "#000",
  },
  canvas: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover", // visual hint only; actual cover logic is in drawFrame()
    display: "block",
  },
  // Hidden video — used only as decode source, never displayed
  hiddenVideo: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
    pointerEvents: "none",
  },
  overlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
    zIndex: 10,
    willChange: "opacity, transform",
  },
  overlayInner: {
    maxWidth: "min(680px, 88vw)",
    textAlign: "center",
    padding: "0 24px",
  },
  heading: {
    fontFamily: FONT_DISPLAY,
    fontSize: "clamp(26px, 4.5vw, 60px)",
    fontWeight: 700,
    letterSpacing: "-0.03em",
    lineHeight: 1.06,
    color: "#fff",
    margin: "0 0 14px",
    textShadow: "0 2px 32px rgba(0,0,0,0.6)",
  },
  body: {
    fontFamily: FONT_BODY,
    fontSize: "clamp(14px, 1.8vw, 19px)",
    fontWeight: 400,
    lineHeight: 1.6,
    color: "rgba(255,255,255,0.8)",
    margin: 0,
    textShadow: "0 1px 16px rgba(0,0,0,0.5)",
  },
  progressWrap: {
    position: "absolute",
    bottom: 28,
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    alignItems: "center",
    gap: 10,
    zIndex: 20,
    opacity: 0.65,
  },
  progressTrack: {
    width: 100,
    height: 2,
    borderRadius: 1,
    backgroundColor: "rgba(255,255,255,0.2)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    width: "0%",
    backgroundColor: "#fff",
    borderRadius: 1,
    // No CSS transition here — JS lerp handles the animation
  },
  progressLabel: {
    fontFamily: "monospace",
    fontSize: 10,
    color: "rgba(255,255,255,0.45)",
    userSelect: "none",
    minWidth: 28,
  },
  loadingOverlay: {
    position: "absolute",
    inset: 0,
    backgroundColor: "#000",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 30,
    transition: "opacity 0.6s ease",
  },
  loadingText: {
    fontFamily: FONT_BODY,
    fontSize: 13,
    color: "rgba(255,255,255,0.4)",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
};

// ─── Default overlays ─────────────────────────────────────────────────────────
const DEFAULT_OVERLAYS = [
  {
    start: 0.0,
    end: 0.18,
    heading: "Engineered for Everything",
    body: "Every component refined. Every surface considered.",
  },
  {
    start: 0.35,
    end: 0.55,
    heading: "Inside the Machine",
    body: "Hundreds of parts. One seamless experience.",
  },
  {
    start: 0.72,
    end: 0.92,
    heading: "Back Together",
    body: "Precision reassembled. Power restored.",
  },
];

// ─── Math helpers ─────────────────────────────────────────────────────────────
/** Linear interpolation */
const lerp = (a, b, t) => a + (b - a) * t;

/** Smoothstep — used for overlay fade curves */
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Draw video frame onto canvas with "cover" fit
 * (canvas CSS width/height ≠ its pixel buffer, so we compute manually)
 */
function drawCover(ctx, video, cw, ch) {
  const vw = video.videoWidth  || cw;
  const vh = video.videoHeight || ch;
  const scale = Math.max(cw / vw, ch / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  const dx = (cw - dw) / 2;
  const dy = (ch - dh) / 2;
  ctx.drawImage(video, dx, dy, dw, dh);
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function ScrollVideoAnimation({
  src = "/product.mp4",
  overlays = DEFAULT_OVERLAYS,
  scrollHeight = 5000,
  lerpFactor = 0.12,       // tweak: lower = more buttery, higher = more responsive
}) {
  const wrapperRef    = useRef(null);
  const canvasRef     = useRef(null);
  const videoRef      = useRef(null);
  const overlayRefs   = useRef([]);
  const fillRef       = useRef(null);
  const labelRef      = useRef(null);
  const loadingRef    = useRef(null);

  // Mutable state shared between rAF loop and ScrollTrigger callback
  // Using refs (not state) so updates never cause re-renders
  const state = useRef({
    targetProgress:  0,   // raw scroll progress 0–1
    currentProgress: 0,   // lerped progress (what we actually render)
    lastDrawnTime:  -1,   // last video.currentTime we drew (for dead-zone skip)
    isReady:        false,
    duration:       1,
    rafId:          null,
  });

  // ── Set scroll height ────────────────────────────────────────────────────
  useEffect(() => {
    if (wrapperRef.current) {
      wrapperRef.current.style.height = `${scrollHeight}px`;
    }
  }, [scrollHeight]);

  // ── Main init ────────────────────────────────────────────────────────────
  useEffect(() => {
    let st;                  // ScrollTrigger instance
    let destroyed = false;

    async function init() {
      // ── Dynamic imports (client-only) ──
      const gsapMod = await import("gsap");
      const stMod   = await import("gsap/ScrollTrigger");
      const gsap    = gsapMod.default || gsapMod.gsap;
      const { ScrollTrigger } = stMod;
      gsap.registerPlugin(ScrollTrigger);

      const video  = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || destroyed) return;

      const ctx = canvas.getContext("2d");

      // ── Video setup ──
      video.muted       = true;
      video.playsInline = true;
      video.preload     = "auto";
      video.src         = src;

      // Size canvas to device pixel ratio for crisp output
      function resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        canvas.width  = canvas.offsetWidth  * dpr;
        canvas.height = canvas.offsetHeight * dpr;
        ctx.scale(dpr, dpr);
      }
      resizeCanvas();
      window.addEventListener("resize", resizeCanvas);

      // ── Wait for video metadata ──
      await new Promise((resolve) => {
        if (video.readyState >= 1) return resolve();
        video.addEventListener("loadedmetadata", resolve, { once: true });
      });

      // ── Buffer the whole video (best for smooth scrubbing) ──
      // We seek to end to force full buffering on supported browsers
      const waitForBuffer = () =>
        new Promise((resolve) => {
          if (video.readyState >= 4) return resolve();
          const onCanPlay = () => resolve();
          video.addEventListener("canplaythrough", onCanPlay, { once: true });
          // Fallback if event never fires (e.g. large file on slow connection)
          setTimeout(resolve, 4000);
        });

      await waitForBuffer();

      if (destroyed) return;

      state.current.duration = video.duration || 1;
      state.current.isReady  = true;

      // Hide loading overlay
      if (loadingRef.current) {
        loadingRef.current.style.opacity = "0";
        setTimeout(() => {
          if (loadingRef.current) loadingRef.current.style.display = "none";
        }, 650);
      }

      // ── Continuous rAF render loop ───────────────────────────────────────
      // This runs every frame regardless of scroll events.
      // It lerps currentProgress toward targetProgress, then:
      //   • seeks video.currentTime (only if delta > 1 frame worth)
      //   • draws the frame to canvas
      //   • updates overlays and progress bar
      function tick() {
        if (destroyed) return;
        state.current.rafId = requestAnimationFrame(tick);

        const s = state.current;
        if (!s.isReady) return;

        // ── Lerp toward target ──
        const prevProgress = s.currentProgress;
        s.currentProgress  = lerp(s.currentProgress, s.targetProgress, lerpFactor);

        // Dead-zone: if we're extremely close, snap and skip draw
        const delta = Math.abs(s.currentProgress - s.targetProgress);
        if (delta < 0.00001) {
          s.currentProgress = s.targetProgress;
        }

        const targetTime = s.currentProgress * s.duration;

        // Skip drawImage if we're within < 1 video frame (perf optimisation)
        const minFrameDelta = s.duration / 60; // ~16ms at 60fps
        if (Math.abs(targetTime - s.lastDrawnTime) < minFrameDelta * 0.5 &&
            s.currentProgress === prevProgress) return;

        // ── Seek & draw ──
        video.currentTime = Math.max(0, Math.min(s.duration, targetTime));
        s.lastDrawnTime   = video.currentTime;

        const w = canvas.offsetWidth;
        const h = canvas.offsetHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Save/restore so DPR scale stays intact
        ctx.save();
        drawCover(ctx, video, w, h);
        ctx.restore();

        // ── Progress bar ──
        const pct = s.currentProgress * 100;
        if (fillRef.current)  fillRef.current.style.width = `${pct}%`;
        if (labelRef.current) labelRef.current.textContent = `${Math.round(pct)}%`;

        // ── Overlay fades ──
        overlayRefs.current.forEach((el, i) => {
          if (!el || !overlays[i]) return;
          const { start, end } = overlays[i];
          const fadeIn  = smoothstep(start, start + 0.055, s.currentProgress);
          const fadeOut = 1 - smoothstep(end - 0.055, end, s.currentProgress);
          const opacity = Math.min(fadeIn, fadeOut);
          const ty      = (1 - opacity) * 20;
          el.style.opacity   = opacity;
          el.style.transform = `translateY(${ty}px)`;
        });
      }

      tick(); // start the loop

      // ── ScrollTrigger — only updates targetProgress ──────────────────────
      // Deliberately NOT using scrub: true so GSAP doesn't fight our lerp loop
      st = ScrollTrigger.create({
        trigger: wrapperRef.current,
        start:   "top top",
        end:     "bottom bottom",
        onUpdate(self) {
          state.current.targetProgress = self.progress;
        },
      });

      // Cleanup resize listener
      return () => window.removeEventListener("resize", resizeCanvas);
    }

    const cleanupPromise = init();

    return () => {
      destroyed = true;
      if (st) st.kill();
      cancelAnimationFrame(state.current.rafId);
      cleanupPromise.then((fn) => fn && fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, lerpFactor]);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div ref={wrapperRef} style={S.wrapper}>
      <div style={S.sticky}>

        {/* Hidden decode-only video — never shown to user */}
        <video
          ref={videoRef}
          style={S.hiddenVideo}
          muted
          playsInline
          preload="auto"
          crossOrigin="anonymous"
        />

        {/* Canvas — receives every drawn frame */}
        <canvas ref={canvasRef} style={S.canvas} />

        {/* Loading screen */}
        <div ref={loadingRef} style={S.loadingOverlay}>
          <span style={S.loadingText}>Loading…</span>
        </div>

        {/* Text overlays */}
        {overlays.map((item, i) => (
          <div
            key={i}
            ref={(el) => (overlayRefs.current[i] = el)}
            style={{ ...S.overlay, opacity: 0 }}
          >
            <div style={S.overlayInner}>
              {item.heading && <h2 style={S.heading}>{item.heading}</h2>}
              {item.body    && <p  style={S.body}>{item.body}</p>}
            </div>
          </div>
        ))}

        {/* Progress indicator */}
        <div style={S.progressWrap}>
          <div style={S.progressTrack}>
            <div ref={fillRef} style={S.progressFill} />
          </div>
          <span ref={labelRef} style={S.progressLabel}>0%</span>
        </div>

      </div>
    </div>
  );
}

// =============================================================================
// USAGE
// =============================================================================
//
//  import ScrollVideoAnimation from "@/components/ScrollVideoAnimation";
//
//  export default function Page() {
//    return (
//      <main>
//        <ScrollVideoAnimation
//          src="/your-product-video.mp4"
//          scrollHeight={6000}
//          lerpFactor={0.10}          // 0.08 = dreamlike | 0.18 = snappy
//          overlays={[
//            { start: 0.0,  end: 0.2,  heading: "Meet the Console",    body: "Designed from the ground up."        },
//            { start: 0.38, end: 0.58, heading: "Inside the Machine",  body: "Hundreds of components, one vision." },
//            { start: 0.75, end: 0.93, heading: "Reassembled",         body: "Every part exactly where it belongs." },
//          ]}
//        />
//      </main>
//    );
//  }
//
// =============================================================================
// SMOOTHNESS TUNING GUIDE
// =============================================================================
//
//  lerpFactor  Feel
//  ──────────  ───────────────────────────────────────────────────────────────
//  0.05        Dreamy / floaty — great for slow cinematic b-roll
//  0.10        Apple-like — default sweet spot
//  0.15        Responsive but still smooth
//  0.20        Near-instant — feels like a fast game engine
//  1.00        No lerp at all — raw seek (same as v1, choppy)
//
// =============================================================================
// VIDEO OPTIMISATION (critical for smooth scrubbing)
// =============================================================================
//
//  The single biggest factor for smooth scrubbing is keyframe density.
//  Re-encode with a keyframe every frame (GOP=1):
//
//    ffmpeg -i input.mp4 \
//      -c:v libx264 \
//      -crf 23 \
//      -g 1 \               ← keyframe every frame  ← THIS IS THE KEY FLAG
//      -preset slow \
//      -an \                ← strip audio (not needed for scroll video)
//      -movflags +faststart \ ← enables progressive download
//      output.mp4
//
//  For WebM (smaller, better for web):
//    ffmpeg -i input.mp4 -c:v libvpx-vp9 -crf 30 -b:v 0 -g 1 -an output.webm
//
//  ⚠️  -g 1 increases file size ~2–3x but makes every frame seekable.
//      Without it, the browser must decode from the previous keyframe
//      which causes the visible "stutter" even with perfect JS.
//
// =============================================================================