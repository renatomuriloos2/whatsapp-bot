import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        rethink: {
          bg: "#17100B",
          orange: "#F08421",
          amber: "#FFB000",
          brown: "#653621",
          green: "#82B534",
          cream: "rgb(var(--rethink-cream-rgb) / <alpha-value>)",
        },
        surface: "rgb(var(--surface-rgb) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["var(--font-poppins)", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
