import { FcGoogle } from 'react-icons/fc'

type GoogleSignInButtonProps = {
  onClick: () => void
  disabled?: boolean
  label?: string
  className?: string
}

export function GoogleSignInButton({
  onClick,
  disabled = false,
  label = 'Sign in with Google',
  className = '',
}: GoogleSignInButtonProps) {
  return (
    <button
      className={`google-signin-btn ${className}`.trim()}
      onClick={onClick}
      disabled={disabled}
      type="button"
      aria-label={label}
    >
      <span className="google-signin-icon" aria-hidden="true">
        <FcGoogle size={18} />
      </span>
      <span>{label}</span>
    </button>
  )
}
