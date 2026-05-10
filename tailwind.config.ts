import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0b0d10",
        card: "#15181d",
        line: "#262a31",
        accent: "#22c55e",
        accentDim: "#16a34a",
        muted: "#8a93a0",
        warn: "#f59e0b",
      },
    },
  },
  plugins: [],
} satisfies Config;
