/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        inbox: {
          bg: "#0b141a",
          panel: "#111b21",
          hover: "#202c33",
          border: "#2a3942",
          accent: "#00a884",
          outbound: "#005c4b",
          inbound: "#202c33",
          muted: "#8696a0",
          text: "#e9edef",
        },
      },
      fontFamily: {
        sans: [
          "IBM Plex Sans Arabic",
          "Segoe UI",
          "Tahoma",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
