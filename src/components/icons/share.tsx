import React from "react";

export const Share = ({
  fillColor = "#C4C4C4",
  strokeColor = "#C4C4C4",
  className,
  size = 24,
}: {
  fillColor: string;
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
        d="M10.4822 1.50254L7.34659 4.61556C6.94586 5.0134 6.97612 5.67022 7.41172 6.02954C7.91373 6.44364 8.60092 6.55272 9.20649 6.31443L10.9545 5.62658C11.3944 5.45349 11.8814 5.4418 12.3291 5.5936L14.852 6.44903C15.2975 6.60009 15.7899 6.45675 16.0848 6.09018C16.4252 5.6669 16.413 5.06037 16.0558 4.65115L13.398 1.60659C12.6384 0.736503 11.3019 0.688805 10.4822 1.50254Z"
        fill={fillColor}
        stroke={strokeColor}
      />
      <path
        d="M11.6358 5.26147V7.84228L11.6358 14.6169"
        stroke={strokeColor}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <path
        d="M3 11.6446V16.9338C3 19.1686 4.8311 20.97 7.06561 20.9333L16.697 20.7753C18.8802 20.7395 20.6313 18.9594 20.6313 16.7758V11.3553"
        stroke={strokeColor}
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
};
