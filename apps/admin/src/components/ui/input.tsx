import * as React from 'react'
import { cn } from '../../lib/utils'

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'flex h-[34px] w-full rounded-[var(--radius-md)] border border-[var(--line-strong)] bg-[var(--bg-1)] px-2.5 text-[0.82rem] text-[var(--ink)] transition-colors placeholder:text-[var(--ink-muted)] focus-visible:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-soft)]',
      className,
    )}
    {...props}
  />
))
Input.displayName = 'Input'

export { Input }
