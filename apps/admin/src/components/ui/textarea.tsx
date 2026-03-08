import * as React from 'react'
import { cn } from '../../lib/utils'

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'flex min-h-[80px] w-full rounded-[var(--radius-md)] border border-[var(--line-medium)] bg-[var(--bg-3)] px-3 py-2.5 text-sm text-[var(--ink)] transition-colors placeholder:text-[var(--ink-muted)] focus-visible:border-[color:color-mix(in_srgb,var(--accent)_50%,transparent)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:color-mix(in_srgb,var(--accent)_30%,transparent)] resize-none',
      className,
    )}
    {...props}
  />
))
Textarea.displayName = 'Textarea'

export { Textarea }
