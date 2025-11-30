import React from "react";

export const OpenInWindow = ({ className, size = 24 }: { className?: string; size?: number }) => {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M19 12.7143V19.2143C19 20.7528 17.8807 22 16.5 22H6.5C5.11929 22 4 20.7528 4 19.2143V11.7857C4 10.2472 5.11929 9 6.5 9H8.16667"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 5L14 1L18 5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14 3V13"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
