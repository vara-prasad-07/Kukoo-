import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#0d0d0f", soft: "#141417", card: "#1a1a1f", line: "#2a2a31" },
        coral: { DEFAULT: "#ff7a5c", dim: "#e0684c", glow: "#ff9d85" },
        mint: "#4ade80",
        sky: "#60a5fa",
        amber: "#fbbf24",
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      keyframes: {
        ring: { "0%,100%": { transform: "rotate(0deg)" }, "20%": { transform: "rotate(-12deg)" }, "40%": { transform: "rotate(12deg)" }, "60%": { transform: "rotate(-8deg)" }, "80%": { transform: "rotate(8deg)" } },
        pulseRing: { "0%": { transform: "scale(1)", opacity: "0.55" }, "100%": { transform: "scale(2.1)", opacity: "0" } },
        slideUp: { from: { opacity: "0", transform: "translateY(10px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        flash: { "0%": { backgroundColor: "rgba(255,122,92,0.28)" }, "100%": { backgroundColor: "transparent" } },
        bar: { "0%,100%": { transform: "scaleY(0.28)" }, "50%": { transform: "scaleY(1)" } },
        shimmer: { "0%": { backgroundPosition: "-500px 0" }, "100%": { backgroundPosition: "500px 0" } },
      },
      animation: {
        ring: "ring 1.1s ease-in-out infinite",
        pulseRing: "pulseRing 1.8s ease-out infinite",
        slideUp: "slideUp 0.28s ease-out both",
        flash: "flash 1.1s ease-out",
        bar: "bar 0.9s ease-in-out infinite",
        shimmer: "shimmer 1.6s linear infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
