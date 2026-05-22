import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "Segoe UI", "sans-serif"],
        display: ["Manrope", "Inter", "Segoe UI", "sans-serif"],
      },
      colors: {
        brand: {
          50: "#ecfdf3",
          100: "#d1fae5",
          600: "#059669",
          700: "#047857",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
