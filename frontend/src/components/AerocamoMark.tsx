interface AerocamoMarkProps {
  size?: number;
  className?: string;
  rounded?: string;
}

/** Aerocamo logomark: a swept wing inside a gradient badge. */
export default function AerocamoMark({ size = 40, className = '', rounded = 'rounded-xl' }: AerocamoMarkProps) {
  return (
    <div
      className={`shrink-0 ${rounded} flex items-center justify-center shadow-lg ${className}`}
      style={{
        width: size,
        height: size,
        background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
      }}
    >
      <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M12 2.5L20.5 19.5C20.5 19.5 14.8 17 12 17C9.2 17 3.5 19.5 3.5 19.5L12 2.5Z"
          fill="white"
          fillOpacity="0.95"
        />
        <path d="M12 2.5L12 17" stroke="#1d4ed8" strokeWidth="0.75" strokeLinecap="round" />
      </svg>
    </div>
  );
}
