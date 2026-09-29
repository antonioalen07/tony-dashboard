interface LogoProps {
  size?: number;
}

/**
 * Monograma "B" (BAKO): badge grafito con una B monolineal construida sobre
 * grilla — tallo recto y dos bowls semicirculares, la inferior apenas más ancha.
 *
 * La jerarquía la da la LUMINANCIA, no el matiz (misma regla que el resto del
 * sistema, ver DESIGN.md): tallo + bowl superior en blanco, bowl inferior en
 * gris medio. Sin color de marca: se lee igual sobre fondo claro u oscuro y no
 * compite con nada de la UI.
 *
 * El orden de los paths importa: la bowl gris va PRIMERO para que el trazo
 * blanco la pise en la barra del medio y la B quede continua, con el salto a
 * gris apareciendo recién después del tallo.
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
      aria-label="BAKO"
    >
      <defs>
        {/* Filo de luz: marcado arriba, se apaga hacia abajo */}
        <linearGradient id="bakoRim" x1="32" y1="0" x2="32" y2="64" gradientUnits="userSpaceOnUse">
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
        stroke="url(#bakoRim)"
        strokeWidth="1.5"
      />

      {/* Bowl inferior (secundaria) */}
      <path
        d="M23 32h11a7.5 7.5 0 0 1 0 15H23"
        stroke="#a1a1aa"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Tallo + bowl superior (primaria) */}
      <path
        d="M23 47V17h9.5a7.5 7.5 0 0 1 0 15H23"
        stroke="#fafafa"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
