import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        "neon-green": "#39FF14",
        "neon-red": "#FF3131",
      },
      boxShadow: {
        neon: "0 0 18px rgba(57, 255, 20, 0.45)",
        danger: "0 0 22px rgba(255, 49, 49, 0.5)",
      },
    },
  },
  plugins: [],
};

export default config;