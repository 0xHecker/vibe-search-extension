import React from "react";

export const OpenArrowIcon = ({ className, size = 24 }: { className?: string; size?: number }) => {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M7.49992 5H7.33325C5.93312 5 5.23305 5 4.69828 5.27248C4.22787 5.51217 3.84542 5.89462 3.60574 6.36503C3.33325 6.8998 3.33325 7.59987 3.33325 9V12.6667C3.33325 14.0668 3.33325 14.7668 3.60574 15.3017C3.84542 15.7721 4.22787 16.1545 4.69828 16.3942C5.23305 16.6667 5.93312 16.6667 7.33325 16.6667H10.9999C12.4001 16.6667 13.1001 16.6667 13.6349 16.3942C14.1053 16.1545 14.4878 15.7721 14.7274 15.3017C14.9999 14.7668 14.9999 14.0668 14.9999 12.6667V12.5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M11.6667 3.33337H16.6667M16.6667 3.33337V8.33337M16.6667 3.33337L9.16675 10.8334"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
