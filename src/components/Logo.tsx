interface LogoProps {
  size?: number;
}

/**
 * Lettermark "N" de la marca personal, recreado como badge circular oscuro
 * con un sutil glow indigo. Se ve bien sobre fondo claro u oscuro.
 */
export default function Logo({ size = 34 }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Logo">
      <defs>
        <radialGradient id="logoGlow" cx="50%" cy="38%" r="62%">
          <stop offset="0%" stopColor="#191a20" />
          <stop offset="100%" stopColor="#070708" />
        </radialGradient>
        <linearGradient id="logoN" x1="20" y1="18" x2="44" y2="46" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#dfe1ff" />
        </linearGradient>
      </defs>

      {/* Badge */}
      <circle cx="32" cy="32" r="31" fill="url(#logoGlow)" />
      <circle cx="32" cy="32" r="31" stroke="#5e6bff" strokeOpacity="0.32" strokeWidth="1.5" />
      <circle cx="32" cy="32" r="27.5" stroke="#ffffff" strokeOpacity="0.06" strokeWidth="1" />

      {/* Lettermark N */}
      <path
        d="M22 44V20h4.6l10.8 15.4V20H42v24h-4.6L26.6 28.6V44H22Z"
        fill="url(#logoN)"
      />
      {/* Punto/acento */}
      <circle cx="40.6" cy="22.2" r="2.5" fill="#5e6bff" />
    </svg>
  );
}
