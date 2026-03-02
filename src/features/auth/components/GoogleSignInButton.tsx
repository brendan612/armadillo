type GoogleSignInButtonProps = {
  onClick: () => void
  disabled?: boolean
  label?: string
  className?: string
}

function GoogleGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.2-1.4 3.6-5.5 3.6-3.3 0-6-2.8-6-6.2s2.7-6.2 6-6.2c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 2.7 14.6 1.8 12 1.8 6.9 1.8 2.8 6 2.8 11.2S6.9 20.5 12 20.5c6.9 0 9.1-4.9 9.1-7.4 0-.5 0-.8-.1-1.2H12z" />
      <path fill="#34A853" d="M2.8 7.4l3.2 2.3c.9-2 3-3.4 6-3.4 1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 2.7 14.6 1.8 12 1.8 8 1.8 4.5 4.1 2.8 7.4z" />
      <path fill="#4A90E2" d="M12 20.5c2.5 0 4.6-.8 6.1-2.2l-2.8-2.3c-.8.6-1.8 1-3.3 1-3 0-5.2-2-6-4.7l-3.3 2.6c1.6 3.3 5 5.6 9.3 5.6z" />
      <path fill="#FBBC05" d="M2.8 11.2c0 1.1.3 2.2.8 3.2l3.3-2.6c-.2-.6-.3-1.1-.3-1.8 0-.6.1-1.2.3-1.8L3.6 5.6c-.5 1-.8 2.1-.8 3.2z" />
    </svg>
  )
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
        <GoogleGlyph />
      </span>
      <span>{label}</span>
    </button>
  )
}
