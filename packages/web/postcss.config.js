export default {
  plugins: {
    // Tailwind v4 ships its PostCSS plugin separately and handles vendor
    // prefixing itself, so autoprefixer is no longer in the pipeline.
    "@tailwindcss/postcss": {},
  },
};
