/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Bifrost bridge palette
        bifrost: {
          50: '#eef6ff',
          100: '#d9eaff',
          200: '#bcdaff',
          300: '#8ec2ff',
          400: '#599fff',
          500: '#337bff',
          600: '#1b5bf5',
          700: '#1448e1',
          800: '#173cb6',
          900: '#19378f',
          950: '#142356',
        },
      },
    },
  },
  plugins: [],
};
