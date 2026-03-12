import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";
import tailwindcssTypography from "@tailwindcss/typography";
import { createPreset } from "fumadocs-ui/tailwind-plugin";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./content/**/*.mdx",
    "./node_modules/fumadocs-ui/dist/**/*.js",
  ],
  presets: [createPreset()],
  darkMode: ['class', "class"],
  theme: {
  	extend: {
  		colors: {
  			brand: {
  				DEFAULT: 'var(--color-brand)',
  				hover: 'var(--color-brand-hover)',
  				faint: 'var(--color-brand-faint)'
  			},
  			surface: {
  				bg: 'var(--color-bg)',
  				card: 'var(--color-card)',
  				raised: 'var(--color-raised)'
  			},
  			border: 'hsl(var(--border))',
  			text: {
  				primary: 'var(--color-text)',
  				muted: 'var(--color-text-muted)',
  				inverse: 'var(--color-text-inverse)'
  			},
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
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			}
  		},
  		borderRadius: {
  			xl: '12px',
  			'2xl': '16px',
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		boxShadow: {
  			glow: '0 0 12px 2px rgba(45,125,255,0.25)',
  			'glow-sm': '0 0 6px 1px rgba(45,125,255,0.2)'
  		},
  		fontFamily: {
  			sans: [
  				'Manrope',
  				'system-ui',
  				'-apple-system',
  				'sans-serif'
  			],
  			mono: [
  				'JetBrains Mono',
  				'Fira Code',
  				'monospace'
  			]
  		},
  		animation: {
  			'pulse-slow': 'pulse-slow 4s ease-in-out infinite'
  		},
  		keyframes: {
  			'pulse-slow': {
  				'0%, 100%': {
  					opacity: '1',
  					transform: 'scale(1)'
  				},
  				'50%': {
  					opacity: '0.8',
  					transform: 'scale(1.05)'
  				}
  			}
  		}
  	}
  },
  plugins: [tailwindcssAnimate, tailwindcssTypography],
};
export default config;
