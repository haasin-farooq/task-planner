/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "dark-bg": "var(--color-bg)",
        "dark-surface": "var(--color-surface)",
        "dark-card": "var(--color-card)",
        "dark-border": "var(--color-border)",
        "dark-hover": "var(--color-hover)",
        "text-primary": "var(--color-text-primary)",
        "text-secondary": "var(--color-text-secondary)",
        "text-muted": "var(--color-text-muted)",
        accent: "var(--color-accent)",
        "accent-light": "var(--color-accent)",
        "accent-dark": "var(--color-accent-dark)",
      },
      fontFamily: {
        serif: ["'Lora'", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};
