/**
 * Theme utilities for AIRunway Headlamp Plugin
 *
 * Provides consistent colors and styling that work with Headlamp's
 * light and dark themes.
 */

export interface BadgeColors {
  bg: string;
  color: string;
}

/**
 * Get badge colors based on type/status
 */
export function getBadgeColors(type: string): BadgeColors {
  switch (type.toLowerCase()) {
    case 'success':
      return { bg: 'rgba(46, 125, 50, 0.15)', color: '#4caf50' };
    case 'error':
      return { bg: 'rgba(198, 40, 40, 0.15)', color: '#f44336' };
    case 'warning':
      return { bg: 'rgba(255, 152, 0, 0.15)', color: '#ff9800' };
    case 'info':
      return { bg: 'rgba(25, 118, 210, 0.15)', color: '#2196f3' };
    case 'neutral':
      return { bg: 'rgba(128, 128, 128, 0.15)', color: 'inherit' };
    case 'gpu':
      return { bg: 'rgba(156, 39, 176, 0.15)', color: '#ab47bc' };
    case 'cpu':
      return { bg: 'rgba(0, 150, 136, 0.15)', color: '#26a69a' };
    default:
      return { bg: 'rgba(128, 128, 128, 0.15)', color: 'inherit' };
  }
}
