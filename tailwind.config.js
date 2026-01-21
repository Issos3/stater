/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        gain: '#22c55e',
        loss: '#ef4444',
      }
    },
  },
  plugins: [],
}
