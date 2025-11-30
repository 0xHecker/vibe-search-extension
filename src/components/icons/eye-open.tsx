import React from "react";

export const EyeOpen = ({ className, size = 24 }: { className?: string; size?: number }) => {
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
        d="M15 12C15 13.6569 13.6569 15 12 15C10.3431 15 9 13.6569 9 12C9 10.3431 10.3431 9 12 9C13.6569 9 15 10.3431 15 12Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M21.2246 10.6522C16.4094 3.11587 7.59077 3.11596 2.77557 10.6523C2.25157 11.4724 2.25157 12.5277 2.77557 13.3478C7.59077 20.8841 16.4094 20.884 21.2246 13.3477C21.7486 12.5276 21.7486 11.4723 21.2246 10.6522Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
