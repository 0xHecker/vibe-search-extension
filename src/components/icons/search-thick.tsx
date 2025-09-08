import React from "react";

export const SearchThickIcon = ({
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
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M11 18C14.866 18 18 14.866 18 11C18 7.13401 14.866 4 11 4C7.13401 4 4 7.13401 4 11C4 14.866 7.13401 18 11 18Z"
        stroke={fillColor}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <path
        d="M19.9998 20L16.0498 16.05"
        stroke={fillColor}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  );
};
