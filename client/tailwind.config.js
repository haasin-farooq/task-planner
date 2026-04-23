/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "dark-bg": "#FAF8F5",
        "dark-surface": "#F0EDE8",
        "dark-card": "#FFFFFF",
        "dark-border": "#E8E4DF",
        accent: "#E8734A",
        "accent-light": "#E8734A",
        "accent-dark": "#D4623B",
      },
      fontFamily: {
        serif: ["'Lora'", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};
