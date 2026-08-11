interface LogoProps {
  size?: number;
}

/**
 * Monograma "DC" (Dashboard Content): badge grafito con letterforms monolineales
 * geométricas — D en blanco (primaria) y C en gris medio (secundaria). Sin color:
 * la jerarquía la da la luminancia, así que se ve igual sobre fondo claro u oscuro.
 */
export default function Logo({ size = 34 }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Dashboard Content"
    >
      <defs>
        {/* Filo de luz: marcado arriba, se apaga hacia abajo */}
        <linearGradient id="dcRim" x1="32" y1="0" x2="32" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.26" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0.09" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.04" />
        </linearGradient>
      </defs>

      {/* Badge grafito */}
      <rect x="0.75" y="0.75" width="62.5" height="62.5" rx="17" fill="#17171a" />
      <rect
        x="0.75"
        y="0.75"
        width="62.5"
        height="62.5"
        rx="17"
        stroke="url(#dcRim)"
        strokeWidth="1.5"
      />

      {/* D */}
      <path
        d="M9 21h7.5a10.5 10.5 0 0 1 0 21H9z"
        stroke="#fafafa"
        strokeWidth="4"
        strokeLinejoin="round"
      />

      {/* C */}
      <path
        d="M50.46 23.23A10.5 10.5 0 1 0 50.46 39.77"
        stroke="#a1a1aa"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}
