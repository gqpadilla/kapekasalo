// Shared Tailwind theme for every page. Load right after the Tailwind CDN script.
tailwind.config = {
  theme: {
    // Replaces Tailwind's default palette so only brand colors (and their pastel tints) exist.
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      papel: '#FFFFFF',
      gata: { DEFAULT: '#F4EBDD', light: '#FAF6EF' },
      tinta: '#141414',
      kalamansi: { DEFAULT: '#F2B732', soft: '#FCF0D0' },
      banga: { DEFAULT: '#A84A2A', soft: '#F5E3DA' },
      ube: '#5B3A8C', // shadows, borders and accent lines only, never a fill
      jeepney: { DEFAULT: '#2456C8', soft: '#E1E8F7' },
      sili: { DEFAULT: '#E8453F', soft: '#FBE4E1' },
    },
    extend: {
      fontFamily: {
        display: ['Provicali', 'Arial Black', 'sans-serif'],
        accent: ['Quiapo', 'Arial Black', 'sans-serif'],
        serif: ['"Apple Garamond"', 'Garamond', 'Georgia', 'serif'],
        sans: ['Helvetica', 'Helvetica Neue', 'Arial', 'sans-serif'],
        label: ['"MADE Sunflower"', 'Arial Black', 'sans-serif'],
        neon: ['"The 2K12"', 'Arial Black', 'sans-serif'], // quoted: an unquoted name with a digit-led word is invalid CSS
      },
      boxShadow: {
        ube: '6px 6px 0 #5B3A8C',
        'ube-sm': '3px 3px 0 #5B3A8C',
        'ube-lg': '10px 10px 0 #5B3A8C',
        kal: '6px 6px 0 #F2B732',
      },
    },
  },
};
