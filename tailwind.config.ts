import type { Config } from "tailwindcss";

export default {
    darkMode: ["class"],
    content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
  	extend: {
  		colors: {
        'isabelline': {
          DEFAULT: '#fcf8f3',
          '100': '#4f3414',
          '200': '#9e6928',
          '300': '#d49b54',
          '400': '#e8c9a4',
          '500': '#fcf8f3',
          '600': '#fdf9f5',
          '700': '#fdfbf8',
          '800': '#fefcfa',
          '900': '#fefefd'
        },
        'dim-gray': {
          DEFAULT: '#646668',
          '100': '#141415',
          '200': '#28292a',
          '300': '#3c3d3e',
          '400': '#505253',
          '500': '#646668',
          '600': '#828587',
          '700': '#a1a3a5',
          '800': '#c1c2c3',
          '900': '#e0e0e1'
        },
        'night': {
          DEFAULT: '#151617',
          '100': '#040505',
          '200': '#09090a',
          '300': '#0d0e0e',
          '400': '#111213',
          '500': '#151617',
          '600': '#424549',
          '700': '#6e747a',
          '800': '#9ea2a7',
          '900': '#ced1d3'
        },
        'orange-wheel': { // Tailwind prefers kebab-case for color names
          DEFAULT: '#fe8318',
          '100': '#381a00',
          '200': '#703401',
          '300': '#a74f01',
          '400': '#df6901',
          '500': '#fe8318',
          '600': '#fe9d48',
          '700': '#feb676',
          '800': '#ffcea4',
          '900': '#ffe7d1'
        },
        'dodger-blue': {
          DEFAULT: '#2491fe',
          '100': '#001d3a',
          '200': '#013a74',
          '300': '#0157ae',
          '400': '#0174e7',
          '500': '#2491fe',
          '600': '#50a7fe',
          '700': '#7cbdfe',
          '800': '#a8d3ff',
          '900': '#d3e9ff'
        },
        // ShadCN theme variables will be defined via CSS variables in globals.css
        // but we keep these for direct Tailwind class usage if needed.
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
