import * as React from 'react'
import { cn } from '../../lib/utils'

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[72px] w-full resize-none rounded-[var(--radius-md)] border border-[var(--line-strong)] bg-[var(--bg-1)] px-2.5 py-2 text-[0.82rem] text-[var(--ink)] transition-colors placeholder:text-[var(--ink-muted)] focus-visible:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-soft)]',
        className,
      )}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'

export { Textarea }
