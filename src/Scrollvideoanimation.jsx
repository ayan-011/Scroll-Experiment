"use client";

/**
 * ScrollVideoAnimation — Apple-style scroll-driven video scrubbing
 *
 * Usage (Next.js App Router):
 *   1. npm install gsap
 *   2. Place your video at /public/product.mp4 (or pass `src` prop)
 *   3. Drop <ScrollVideoAnimation /> into any page
 *
 * Props:
 *   src          – video URL (default: "/product.mp4")
 *   overlays     – array of { start, end, heading, body } scroll-progress markers (0–1)
 *   scrollHeight – px height of the scroll track (default: 5000)
 */

import { useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Inline styles (no external CSS file needed, works in any Next.js project)
// ---------------------------------------------------------------------------
const styles = {
  wrapper: {
    position: "relative",
    height: "var(--scroll-height, 5000px)",
    // Scroll height is set via CSS variable injected at runtime
  },
  sticky: {
    position: "sticky",
    top: 0,
    height: "100vh",
    width: "100%",
    overflow: "hidden",
    backgroundColor: "#000",
  },
  video: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
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
  },
  overlayInner: {
    maxWidth: "min(680px, 90vw)",
    textAlign: "center",
    padding: "0 24px",
  },
  heading: {
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif",
    fontSize: "clamp(28px, 5vw, 64px)",
    fontWeight: 700,
    letterSpacing: "-0.03em",
    lineHeight: 1.05,
    color: "#fff",
    margin: "0 0 16px",
    textShadow: "0 2px 24px rgba(0,0,0,0.55)",
  },
  body: {
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif",
    fontSize: "clamp(15px, 2vw, 20px)",
    fontWeight: 400,
    lineHeight: 1.55,
    color: "rgba(255,255,255,0.82)",
    margin: 0,
    textShadow: "0 1px 12px rgba(0,0,0,0.45)",
  },
  progress: {
    position: "absolute",
    bottom: 32,
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    alignItems: "center",
    gap: 10,
    zIndex: 20,
    opacity: 0.7,
  },
  progressBar: {
    width: 120,
    height: 2,
    borderRadius: 1,
    backgroundColor: "rgba(255,255,255,0.25)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    width: "0%",
    backgroundColor: "#fff",
    borderRadius: 1,
    transition: "width 0.05s linear",
  },
  progressLabel: {
    fontFamily: "monospace",
    fontSize: 11,
    color: "rgba(255,255,255,0.5)",
    userSelect: "none",
  },
};

// ---------------------------------------------------------------------------
// Default overlay content — override via `overlays` prop
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Easing helper — smoothstep for silky scrubbing
// ---------------------------------------------------------------------------
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function ScrollVideoAnimation({
  src = "/product.mp4",
  overlays = DEFAULT_OVERLAYS,
  scrollHeight = 5000,
}) {
  const wrapperRef = useRef(null);
  const videoRef = useRef(null);
  const overlayRefs = useRef([]);
  const fillRef = useRef(null);
  const labelRef = useRef(null);
  const rafRef = useRef(null);
  const gsapCtx = useRef(null);

  // Set scroll height CSS variable
  useEffect(() => {
    if (wrapperRef.current) {
      wrapperRef.current.style.setProperty(
        "--scroll-height",
        `${scrollHeight}px`
      );
    }
  }, [scrollHeight]);

  useEffect(() => {
    // Dynamically import GSAP so it's only loaded client-side
    let st;

    async function init() {
      const gsapModule = await import("gsap");
      const scrollTriggerModule = await import("gsap/ScrollTrigger");
      const gsap = gsapModule.default || gsapModule.gsap;
      const { ScrollTrigger } = scrollTriggerModule;

      gsap.registerPlugin(ScrollTrigger);

      const video = videoRef.current;
      if (!video) return;

      // ── Preload strategy ──────────────────────────────────────────────────
      video.preload = "auto";
      video.muted = true;
      video.playsInline = true;
      video.pause();

      // Wait for enough metadata to know duration
      await new Promise((resolve) => {
        if (video.readyState >= 1) return resolve();
        video.addEventListener("loadedmetadata", resolve, { once: true });
      });

      const duration = video.duration || 1;

      // ── ScrollTrigger setup ───────────────────────────────────────────────
      st = ScrollTrigger.create({
        trigger: wrapperRef.current,
        start: "top top",
        end: "bottom bottom",
        scrub: false, // We handle scrubbing manually for max control
        onUpdate(self) {
          const progress = self.progress; // 0 → 1

          // Target video time
          const targetTime = progress * duration;

          // Smooth scrub via rAF
          cancelAnimationFrame(rafRef.current);
          rafRef.current = requestAnimationFrame(() => {
            // Clamp to valid range
            video.currentTime = Math.max(
              0,
              Math.min(duration, targetTime)
            );

            // Progress bar
            if (fillRef.current) {
              fillRef.current.style.width = `${progress * 100}%`;
            }
            if (labelRef.current) {
              labelRef.current.textContent = `${Math.round(
                progress * 100
              )}%`;
            }

            // Overlay fade logic
            overlayRefs.current.forEach((el, i) => {
              if (!el) return;
              const { start, end } = overlays[i];
              const mid = (start + end) / 2;
              const fadeIn = smoothstep(start, start + 0.06, progress);
              const fadeOut = 1 - smoothstep(end - 0.06, end, progress);
              el.style.opacity = Math.min(fadeIn, fadeOut);
              el.style.transform = `translateY(${
                (1 - Math.min(fadeIn, fadeOut)) * 18
              }px)`;
            });
          });
        },
      });
    }

    init();

    return () => {
      if (st) st.kill();
      cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, scrollHeight]);

  return (
    <div ref={wrapperRef} style={styles.wrapper}>
      {/* ── Sticky viewport ── */}
      <div style={styles.sticky}>
        {/* Video */}
        <video
          ref={videoRef}
          src={src}
          style={styles.video}
          muted
          playsInline
          preload="auto"
          // Prevent any browser autoplay
          autoPlay={false}
        />

        {/* Text overlays */}
        {overlays.map((item, i) => (
          <div
            key={i}
            ref={(el) => (overlayRefs.current[i] = el)}
            style={{
              ...styles.overlay,
              opacity: 0,
              transition: "opacity 0.05s, transform 0.05s",
            }}
          >
            <div style={styles.overlayInner}>
              {item.heading && (
                <h2 style={styles.heading}>{item.heading}</h2>
              )}
              {item.body && <p style={styles.body}>{item.body}</p>}
            </div>
          </div>
        ))}

        {/* Scroll progress indicator */}
        <div style={styles.progress}>
          <div style={styles.progressBar}>
            <div ref={fillRef} style={styles.progressFill} />
          </div>
          <span ref={labelRef} style={styles.progressLabel}>
            0%
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HOW TO USE
// ---------------------------------------------------------------------------
//
// app/page.jsx (or pages/index.jsx):
//
//   import ScrollVideoAnimation from "@/components/ScrollVideoAnimation";
//
//   export default function Page() {
//     return (
//       <main>
//         <section style={{ height: "100vh", display: "grid", placeItems: "center" }}>
//           <h1>My Product</h1>
//         </section>
//
//         <ScrollVideoAnimation
//           src="/product.mp4"
//           scrollHeight={6000}
//           overlays={[
//             { start: 0.0, end: 0.2, heading: "Meet the Console",  body: "Designed from the ground up." },
//             { start: 0.4, end: 0.6, heading: "Inside the Machine", body: "Hundreds of components, one vision." },
//             { start: 0.75, end: 0.95, heading: "Reassembled",      body: "Every part exactly where it belongs." },
//           ]}
//         />
//
//         <section style={{ height: "100vh", display: "grid", placeItems: "center" }}>
//           <h1>What's next</h1>
//         </section>
//       </main>
//     );
//   }
//
// ---------------------------------------------------------------------------
// PERFORMANCE TIPS
// ---------------------------------------------------------------------------
//
// 1. VIDEO FORMAT — Convert to MP4 (H.264) for widest support, plus WebM
//    as a smaller fallback:
//      ffmpeg -i input.mp4 -c:v libx264 -crf 23 -preset slow -an output.mp4
//      ffmpeg -i input.mp4 -c:v libvpx-vp9 -crf 30 -b:v 0 -an output.webm
//    Use <source> tags if you want both:
//      <video>
//        <source src="/product.webm" type="video/webm" />
//        <source src="/product.mp4"  type="video/mp4"  />
//      </video>
//
// 2. PRELOAD — The component uses preload="auto". For large videos, consider
//    a low-res poster image so the page feels instant.
//
// 3. NEXT.JS CONFIG — If hosting the video in /public, no extra config needed.
//    For external CDN, add it to next.config.js remotePatterns.
//
// 4. MOBILE — objectFit: "cover" ensures the video fills any screen.
//    Test scrubbing on iOS Safari — it supports seek but can be slow on
//    very large files. Keep your video under ~80 MB for best mobile perf.
//
// 5. REDUCED MOTION — Add this inside the useEffect to respect user prefs:
//      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;