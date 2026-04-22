/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "dark-bg": "#1a1a2e",
        "dark-surface": "#232342",
        "dark-card": "#2a2a4a",
        "dark-border": "#3a3a5a",
        accent: "#7c3aed",
        "accent-light": "#8b5cf6",
        "accent-dark": "#6d28d9",
      },
    },
  },
  plugins: [],
};
