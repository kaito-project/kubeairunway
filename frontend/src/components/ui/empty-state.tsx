import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "./button"
import { 
  Package, 
  Rocket, 
  Search, 
  FileQuestion,
  type LucideIcon 
} from "lucide-react"

interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Preset illustrations for common scenarios
   */
  preset?: "no-data" | "no-results" | "no-deployments" | "error" | "custom"
  /**
   * Custom icon to display (used when preset is "custom")
   */
  icon?: LucideIcon
  /**
   * Main heading text
   */
  title: string
  /**
   * Descriptive text below the title
   */
  description?: string
  /**
   * Primary action button text
   */
  actionLabel?: string
  /**
   * Primary action click handler
   */
  onAction?: () => void
  /**
   * Secondary action button text
   */
  secondaryActionLabel?: string
  /**
   * Secondary action click handler
   */
  onSecondaryAction?: () => void
}

const presetIcons: Record<Exclude<EmptyStateProps["preset"], "custom" | undefined>, LucideIcon> = {
  "no-data": Package,
  "no-results": Search,
  "no-deployments": Rocket,
  "error": FileQuestion,
}

const presetColors: Record<Exclude<EmptyStateProps["preset"], "custom" | undefined>, string> = {
  "no-data": "text-primary/70",
  "no-results": "text-primary/70",
  "no-deployments": "text-primary/60",
  "error": "text-destructive/60",
}

const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  (
    {
      className,
      preset = "no-data",
      icon,
      title,
      description,
      actionLabel,
      onAction,
      secondaryActionLabel,
      onSecondaryAction,
      children,
      ...props
    },
    ref
  ) => {
    const Icon = preset === "custom" && icon ? icon : presetIcons[preset as keyof typeof presetIcons]
    const iconColor = preset === "custom" ? "text-muted-foreground" : presetColors[preset as keyof typeof presetColors]

    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col items-center justify-center text-center py-12 px-6",
          "animate-fade-in",
          className
        )}
        {...props}
      >
        {/* Decorative background circle */}
        <div className="relative mb-6">
          <div className="absolute inset-0 bg-primary/5 rounded-full blur-2xl scale-150" />
          <div className="relative p-4 bg-white/[0.03] rounded-full">
            <div className="p-3 bg-white/[0.05] rounded-full shadow-soft border border-white/10">
              {Icon && <Icon className={cn("h-8 w-8", iconColor)} strokeWidth={1.5} />}
            </div>
          </div>
        </div>

        {/* Text content */}
        <h3 className="text-lg font-semibold text-foreground mb-1">
          {title}
        </h3>
        {description && (
          <p className="text-sm text-muted-foreground max-w-sm mb-6">
            {description}
          </p>
        )}

        {/* Actions */}
        {(actionLabel || secondaryActionLabel || children) && (
          <div className="flex flex-col sm:flex-row items-center gap-3">
            {actionLabel && onAction && (
              <Button onClick={onAction} className="min-w-[120px]">
                {actionLabel}
              </Button>
            )}
            {secondaryActionLabel && onSecondaryAction && (
              <Button
                variant="outline"
                onClick={onSecondaryAction}
                className="min-w-[120px]"
              >
                {secondaryActionLabel}
              </Button>
            )}
            {children}
          </div>
        )}
      </div>
    )
  }
)
EmptyState.displayName = "EmptyState"

export { EmptyState }
