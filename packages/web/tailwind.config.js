/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // FICSIT-informed accent (original palette, not extracted assets).
        ficsit: {
          orange: "#f2a33c",
        },
      },
    },
  },
  plugins: [],
};
