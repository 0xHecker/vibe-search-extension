export const ArrowRight = ({
  className,
  fillColor = "#B0B0B0",
  size = 24,
}: {
  className: string;
  fillColor?: string;
  size?: number;
}) => {
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
        d="M20.7798 10.4948L15.4819 5.85916C14.952 5.39549 14.1396 5.48048 13.7172 6.04377C13.3197 6.57376 13.4223 7.32486 13.9474 7.72878L17.5356 10.4889C18.5459 11.2661 18.5811 12.7775 17.608 13.6009L13.8702 16.7636C13.4018 17.16 13.3722 17.8722 13.8061 18.3061C14.1966 18.6966 14.8229 18.7174 15.2385 18.3538L20.7798 13.5052C21.6905 12.7083 21.6905 11.2917 20.7798 10.4948Z"
        fill={fillColor}
        stroke={fillColor}
      />
      <path d="M18.5 12H14.5H4" stroke={fillColor} strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
};
