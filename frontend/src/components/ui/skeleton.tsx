import * as React from "react"
import { cn } from "@/lib/utils"

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 
   * Preset skeleton variants for common UI patterns
   */
  variant?: "default" | "text" | "heading" | "avatar" | "button" | "card" | "table-row"
  /**
   * Whether to show the shimmer animation
   * @default true
   */
  animate?: boolean
}

const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className, variant = "default", animate = true, ...props }, ref) => {
    const variantStyles = {
      default: "",
      text: "h-4 w-full rounded",
      heading: "h-6 w-3/4 rounded",
      avatar: "h-10 w-10 rounded-full",
      button: "h-10 w-24 rounded-md",
      card: "h-32 w-full rounded-lg",
      "table-row": "h-12 w-full rounded",
    }

    return (
      <div
        ref={ref}
        className={cn(
          "bg-white/[0.06]",
          animate && "shimmer",
          variantStyles[variant],
          className
        )}
        {...props}
      />
    )
  }
)
Skeleton.displayName = "Skeleton"

/**
 * Pre-composed skeleton for card layouts
 */
interface SkeletonCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Show header placeholder */
  showHeader?: boolean
  /** Show avatar in header */
  showAvatar?: boolean
  /** Number of text lines to show */
  lines?: number
  /** Show footer placeholder */
  showFooter?: boolean
}

const SkeletonCard = React.forwardRef<HTMLDivElement, SkeletonCardProps>(
  ({ className, showHeader = true, showAvatar = false, lines = 3, showFooter = false, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "rounded-2xl border border-white/5 bg-white/[0.03] p-6 shadow-soft-sm",
          className
        )}
        {...props}
      >
        {showHeader && (
          <div className="flex items-center gap-3 mb-4">
            {showAvatar && <Skeleton variant="avatar" />}
            <div className="flex-1 space-y-2">
              <Skeleton variant="heading" />
              <Skeleton variant="text" className="w-1/2" />
            </div>
          </div>
        )}
        <div className="space-y-2">
          {Array.from({ length: lines }).map((_, i) => (
            <Skeleton
              key={i}
              variant="text"
              className={i === lines - 1 ? "w-2/3" : undefined}
            />
          ))}
        </div>
        {showFooter && (
          <div className="flex gap-2 mt-4 pt-4 border-t">
            <Skeleton variant="button" />
            <Skeleton variant="button" className="w-20" />
          </div>
        )}
      </div>
    )
  }
)
SkeletonCard.displayName = "SkeletonCard"

/**
 * Pre-composed skeleton for table rows
 */
interface SkeletonTableProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Number of rows to display */
  rows?: number
  /** Number of columns per row */
  columns?: number
}

const SkeletonTable = React.forwardRef<HTMLDivElement, SkeletonTableProps>(
  ({ className, rows = 5, columns = 4, ...props }, ref) => {
    return (
      <div ref={ref} className={cn("space-y-2", className)} {...props}>
        {/* Header row */}
        <div className="flex gap-4 p-3 bg-white/[0.04] rounded-t-lg">
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton
              key={`header-${i}`}
              variant="text"
              className="flex-1 h-4"
              animate={false}
            />
          ))}
        </div>
        {/* Body rows */}
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div
            key={`row-${rowIndex}`}
            className="flex gap-4 p-3 border-b border-border/50"
          >
            {Array.from({ length: columns }).map((_, colIndex) => (
              <Skeleton
                key={`cell-${rowIndex}-${colIndex}`}
                variant="text"
                className="flex-1 h-4"
                style={{
                  // Stagger animation for visual interest
                  animationDelay: `${(rowIndex * columns + colIndex) * 50}ms`,
                }}
              />
            ))}
          </div>
        ))}
      </div>
    )
  }
)
SkeletonTable.displayName = "SkeletonTable"

/**
 * Pre-composed skeleton for model/deployment grid
 */
interface SkeletonGridProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Number of items to display */
  count?: number
}

const SkeletonGrid = React.forwardRef<HTMLDivElement, SkeletonGridProps>(
  ({ className, count = 6, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "grid gap-4 sm:grid-cols-2 lg:grid-cols-3",
          className
        )}
        {...props}
      >
        {Array.from({ length: count }).map((_, i) => (
          <SkeletonCard
            key={i}
            showHeader
            lines={2}
            showFooter
            style={{
              // Stagger animation
              animationDelay: `${i * 100}ms`,
            }}
          />
        ))}
      </div>
    )
  }
)
SkeletonGrid.displayName = "SkeletonGrid"

export { Skeleton, SkeletonCard, SkeletonTable, SkeletonGrid }
