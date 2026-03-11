/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ['Satoshi', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        cyan: {
          DEFAULT: "#00D9FF",
          50: "#ECFEFF",
          100: "#CFFAFE",
          200: "#A5F3FC",
          300: "#67E8F9",
          400: "#22D3EE",
          500: "#00D9FF",
          600: "#00B8D9",
          700: "#0097B2",
          800: "#00758C",
          900: "#005466",
        },
        nvidia: {
          DEFAULT: "#76B900",
          dark: "#5A8F00",
          light: "#8DD100",
        },
        ray: {
          DEFAULT: "#3B82F6",
          dark: "#2563EB",
          light: "#60A5FA",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        // Refined shadow scale for depth hierarchy
        "soft-xs": "0 1px 2px 0 rgb(0 0 0 / 0.03)",
        "soft-sm": "0 1px 3px 0 rgb(0 0 0 / 0.04), 0 1px 2px -1px rgb(0 0 0 / 0.04)",
        "soft": "0 2px 8px -2px rgb(0 0 0 / 0.06), 0 4px 12px -4px rgb(0 0 0 / 0.08)",
        "soft-md": "0 4px 12px -2px rgb(0 0 0 / 0.08), 0 8px 24px -4px rgb(0 0 0 / 0.10)",
        "soft-lg": "0 8px 24px -4px rgb(0 0 0 / 0.10), 0 16px 48px -8px rgb(0 0 0 / 0.12)",
        "lifted": "0 8px 30px rgb(0 0 0 / 0.12)",
        "glow": "0 0 20px rgb(var(--glow-color) / 0.15)",
        "glow-sm": "0 0 10px rgb(var(--glow-color) / 0.10)",
        "glow-cyan": "0 0 20px -4px rgba(0, 217, 255, 0.25)",
        "glow-card": "0 0 30px -8px rgba(0, 217, 255, 0.12)",
        "glow-button": "0 0 20px -4px rgba(0, 217, 255, 0.25)",
        "inner-soft": "inset 0 2px 4px 0 rgb(0 0 0 / 0.04)",
      },
      backdropBlur: {
        xs: "2px",
      },
      transitionTimingFunction: {
        // Apple-style easing curves
        "ease-out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
        "ease-out-quart": "cubic-bezier(0.25, 1, 0.5, 1)",
        "ease-in-out-quart": "cubic-bezier(0.76, 0, 0.24, 1)",
        "spring": "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
      transitionDuration: {
        "DEFAULT": "var(--duration-normal)",
        "fast": "var(--duration-fast)",
        "slow": "var(--duration-slow)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0", opacity: "0" },
          to: { height: "var(--radix-accordion-content-height)", opacity: "1" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)", opacity: "1" },
          to: { height: "0", opacity: "0" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "fade-out": {
          from: { opacity: "1" },
          to: { opacity: "0" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-down": {
          from: { opacity: "0", transform: "translateY(-8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in-right": {
          from: { opacity: "0", transform: "translateX(100%)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        "slide-out-right": {
          from: { opacity: "1", transform: "translateX(0)" },
          to: { opacity: "0", transform: "translateX(100%)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "scale-out": {
          from: { opacity: "1", transform: "scale(1)" },
          to: { opacity: "0", transform: "scale(0.95)" },
        },
        "shimmer": {
          from: { backgroundPosition: "200% 0" },
          to: { backgroundPosition: "-200% 0" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.6" },
        },
        "shake": {
          "0%, 100%": { transform: "translateX(0)" },
          "10%, 30%, 50%, 70%, 90%": { transform: "translateX(-2px)" },
          "20%, 40%, 60%, 80%": { transform: "translateX(2px)" },
        },
        "confetti-fall": {
          "0%": { transform: "translateY(-10vh) rotate(0deg)", opacity: "1" },
          "100%": { transform: "translateY(100vh) rotate(720deg)", opacity: "0" },
        },
        "confetti-spin": {
          "0%": { transform: "rotateX(0) rotateY(0)" },
          "100%": { transform: "rotateX(360deg) rotateY(180deg)" },
        },
        "bounce-subtle": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-4px)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        "accordion-up": "accordion-up 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
        "fade-in": "fade-in var(--duration-normal) cubic-bezier(0.16, 1, 0.3, 1)",
        "fade-out": "fade-out var(--duration-fast) ease-out",
        "slide-up": "slide-up var(--duration-normal) cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-down": "slide-down var(--duration-normal) cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-in-right": "slide-in-right var(--duration-normal) cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-out-right": "slide-out-right var(--duration-fast) ease-out",
        "scale-in": "scale-in var(--duration-normal) cubic-bezier(0.16, 1, 0.3, 1)",
        "scale-out": "scale-out var(--duration-fast) ease-out",
        "shimmer": "shimmer 2s linear infinite",
        "pulse-soft": "pulse-soft 2s ease-in-out infinite",
        "shake": "shake 0.4s ease-in-out",
        "confetti-fall": "confetti-fall 1s ease-out forwards",
        "confetti-spin": "confetti-spin 0.6s linear infinite",
        "bounce-subtle": "bounce-subtle 1s ease-in-out infinite",
      },
    },
  },
  plugins: [],
}
