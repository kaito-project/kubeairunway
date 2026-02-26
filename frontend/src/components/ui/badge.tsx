import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  [
    "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
    "transition-all duration-150 ease-out",
    "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  ],
  {
    variants: {
      variant: {
        default: [
          "border-transparent bg-primary text-primary-foreground",
          "hover:bg-primary/80",
        ],
        secondary: [
          "border-transparent bg-secondary text-secondary-foreground",
          "hover:bg-secondary/80",
        ],
        destructive: [
          "border-transparent bg-destructive/15 text-destructive",
          "hover:bg-destructive/25",
        ],
        outline: "text-foreground border-border",
        success: [
          "border-transparent bg-green-500/15 text-green-600",
          "dark:bg-green-500/20 dark:text-green-400",
        ],
        warning: [
          "border-transparent bg-yellow-500/15 text-yellow-600",
          "dark:bg-yellow-500/20 dark:text-yellow-400",
        ],
        info: [
          "border-transparent bg-blue-500/15 text-blue-600",
          "dark:bg-blue-500/20 dark:text-blue-400",
        ],
      },
      pulse: {
        true: "animate-pulse-soft",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      pulse: false,
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  /** Optional dot indicator before text */
  dot?: boolean
  /** Color of the dot (uses current text color if not specified) */
  dotColor?: string
}

const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant, pulse, dot, dotColor, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(badgeVariants({ variant, pulse }), className)}
        {...props}
      >
        {dot && (
          <span
            className="h-1.5 w-1.5 rounded-full bg-current"
            style={dotColor ? { backgroundColor: dotColor } : undefined}
          />
        )}
        {children}
      </div>
    )
  }
)
Badge.displayName = "Badge"

// eslint-disable-next-line react-refresh/only-export-components
export { Badge, badgeVariants }
