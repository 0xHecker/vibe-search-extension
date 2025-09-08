import React from "react";

export const PinIcon = ({ className, size = 24 }: { className?: string; size?: number }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M10.5 2C8.29086 2 6.5 3.79086 6.5 6V7.49926C6.5 8.83524 5.96928 10.1165 5.0246 11.0612C4.36856 11.7172 4 12.607 4 13.5348V15C4 15.5523 4.44772 16 5 16H11V21C11 21.5523 11.4477 22 12 22C12.5523 22 13 21.5523 13 21V16H19C19.5523 16 20 15.5523 20 15V13.5348C20 12.607 19.6314 11.7172 18.9754 11.0612C18.0307 10.1165 17.5 8.83524 17.5 7.49926V6C17.5 3.79086 15.7091 2 13.5 2H10.5Z"
        fill="currentColor"
      />
    </svg>
  );
};

export const PinShadowIcon = ({ className, size = 24 }: { className?: string; size?: number }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* 1. Define the shadow filter */}
      <defs>
        <filter id="pin-sticker-shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="0" stdDeviation="1.5" floodColor="#000" floodOpacity="0.45" />
        </filter>
      </defs>

      {/* Group the layers for clarity */}
      <g>
        {/* 2. Bottom Layer: The white outline that casts the shadow */}
        <path
          d="M10.5 2C8.29086 2 6.5 3.79086 6.5 6V7.49926C6.5 8.83524 5.96928 10.1165 5.0246 11.0612C4.36856 11.7172 4 12.607 4 13.5348V15C4 15.5523 4.44772 16 5 16H11V21C11 21.5523 11.4477 22 12 22C12.5523 22 13 21.5523 13 21V16H19C19.5523 16 20 15.5523 20 15V13.5348C20 12.607 19.6314 11.7172 18.9754 11.0612C18.0307 10.1165 17.5 8.83524 17.5 7.49926V6C17.5 3.79086 15.7091 2 13.5 2H10.5Z"
          fill="white"
          stroke="white"
          strokeWidth="4.5"
          strokeLinejoin="round"
          filter="url(#pin-sticker-shadow)"
        />

        {/* 3. Top Layer: The original icon */}
        <path
          d="M10.5 2C8.29086 2 6.5 3.79086 6.5 6V7.49926C6.5 8.83524 5.96928 10.1165 5.0246 11.0612C4.36856 11.7172 4 12.607 4 13.5348V15C4 15.5523 4.44772 16 5 16H11V21C11 21.5523 11.4477 22 12 22C12.5523 22 13 21.5523 13 21V16H19C19.5523 16 20 15.5523 20 15V13.5348C20 12.607 19.6314 11.7172 18.9754 11.0612C18.0307 10.1165 17.5 8.83524 17.5 7.49926V6C17.5 3.79086 15.7091 2 13.5 2H10.5Z"
          fill="currentColor"
        />
      </g>
    </svg>
  );
};
