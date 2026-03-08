import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]',
  {
    variants: {
      variant: {
        default: 'border-[color:color-mix(in_srgb,var(--accent)_28%,transparent)] bg-[var(--accent-soft)] text-[var(--accent)]',
        muted: 'border-[var(--line)] bg-[var(--bg-3)] text-[var(--ink-muted)]',
        success: 'border-[color:color-mix(in_srgb,var(--safe)_28%,transparent)] bg-[var(--safe-soft)] text-[var(--safe)]',
        danger: 'border-[color:color-mix(in_srgb,var(--exposed)_28%,transparent)] bg-[var(--exposed-soft)] text-[var(--exposed)]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge }
