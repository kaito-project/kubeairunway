import * as React from "react"
import { cn } from "@/lib/utils"

interface ConfettiPiece {
  id: number
  x: number
  color: string
  delay: number
  duration: number
  rotation: number
}

interface ConfettiProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Whether to show the confetti animation
   */
  active?: boolean
  /**
   * Number of confetti pieces
   * @default 50
   */
  count?: number
  /**
   * Duration of the animation in ms
   * @default 3000
   */
  duration?: number
  /**
   * Callback when animation completes
   */
  onComplete?: () => void
}

const COLORS = [
  "#76B900", // nvidia green
  "#FFD700", // gold
  "#FF6B6B", // coral
  "#4ECDC4", // teal
  "#A855F7", // purple
  "#3B82F6", // blue
]

/**
 * Lightweight confetti burst animation component
 * Perfect for celebrating first deployments or achievements
 */
const Confetti = React.forwardRef<HTMLDivElement, ConfettiProps>(
  ({ className, active = false, count = 50, duration = 3000, onComplete, ...props }, ref) => {
    const [pieces, setPieces] = React.useState<ConfettiPiece[]>([])
    const [isVisible, setIsVisible] = React.useState(false)

    // Check for reduced motion preference
    const prefersReducedMotion = React.useMemo(() => {
      if (typeof window === "undefined") return false
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    }, [])

    React.useEffect(() => {
      if (!active || prefersReducedMotion) {
        setIsVisible(false)
        setPieces([])
        return
      }

      // Generate confetti pieces
      const newPieces: ConfettiPiece[] = Array.from({ length: count }, (_, i) => ({
        id: i,
        x: Math.random() * 100, // Random horizontal position (%)
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        delay: Math.random() * 0.3, // Stagger start times
        duration: 0.8 + Math.random() * 0.4, // Vary fall duration
        rotation: Math.random() * 360,
      }))

      setPieces(newPieces)
      setIsVisible(true)

      // Clean up after animation
      const timer = setTimeout(() => {
        setIsVisible(false)
        setPieces([])
        onComplete?.()
      }, duration)

      return () => clearTimeout(timer)
    }, [active, count, duration, onComplete, prefersReducedMotion])

    if (!isVisible || prefersReducedMotion) return null

    return (
      <div
        ref={ref}
        className={cn(
          "fixed inset-0 pointer-events-none z-50 overflow-hidden",
          className
        )}
        aria-hidden="true"
        {...props}
      >
        {pieces.map((piece) => (
          <div
            key={piece.id}
            className="absolute top-0 animate-confetti-fall"
            style={{
              left: `${piece.x}%`,
              animationDelay: `${piece.delay}s`,
              animationDuration: `${piece.duration}s`,
            }}
          >
            <div
              className="w-2 h-3 rounded-sm animate-confetti-spin"
              style={{
                backgroundColor: piece.color,
                transform: `rotate(${piece.rotation}deg)`,
                animationDuration: `${0.5 + Math.random() * 0.5}s`,
              }}
            />
          </div>
        ))}
      </div>
    )
  }
)
Confetti.displayName = "Confetti"

/**
 * Hook to trigger confetti animation
 */
function useConfetti(duration = 3000) {
  const [isActive, setIsActive] = React.useState(false)

  const trigger = React.useCallback(() => {
    setIsActive(true)
  }, [])

  const handleComplete = React.useCallback(() => {
    setIsActive(false)
  }, [])

  return {
    isActive,
    trigger,
    handleComplete,
    ConfettiComponent: (props: Omit<ConfettiProps, "active" | "onComplete">) => (
      <Confetti {...props} active={isActive} onComplete={handleComplete} duration={duration} />
    ),
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export { Confetti, useConfetti }
