import React from "react";

export const DotIcon = ({ className, size = 20 }: { className?: string; size?: number }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M9.99999 11.2C10.6627 11.2 11.2 10.6628 11.2 10C11.2 9.33731 10.6627 8.80005 9.99999 8.80005C9.33725 8.80005 8.79999 9.33731 8.79999 10C8.79999 10.6628 9.33725 11.2 9.99999 11.2Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
};
