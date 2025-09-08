import React from "react";

export const Filter = ({
  strokeColor = "#C6C6C6",
  className,
  size = 24,
}: {
  strokeColor: string;
  className?: string;
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
        d="M17.1717 3H6.82854C5.26644 3 4.00011 4.33627 4.00011 5.98464C4.00011 6.77621 4.2981 7.53537 4.82854 8.0951L9.12143 12.6251C9.68404 13.2187 10.0001 14.024 10.0001 14.8635V19.9438C10.0001 20.6806 10.6975 21.1906 11.3512 20.9318L13.3512 20.1404C13.7415 19.986 14.0001 19.5922 14.0001 19.1524V14.8635C14.0001 14.024 14.3162 13.2187 14.8788 12.6251L19.1717 8.0951C19.7021 7.53537 20.0001 6.77621 20.0001 5.98464C20.0001 4.33627 18.7338 3 17.1717 3Z"
        stroke={strokeColor}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
    </svg>
  );
};
