import React from "react";

export const PlusLargeIcon = ({
  className,
  fillColor = "#B0B0B0",
  size = 24,
}: {
  className?: string;
  fillColor?: string;
  size?: number;
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fillColor}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M12 4V12M12 12V20M12 12H4M12 12H20"
        stroke={fillColor}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  );
};
