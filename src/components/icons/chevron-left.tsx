export const ChevronLeft = ({ className, size = 24 }: { className?: string; size?: number }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ transform: "scaleX(-1)" }}
    >
      <path
        d="M18.4327 10.5377L9.76379 2.44925C8.94282 1.68326 7.63434 1.81921 6.98838 2.73761C6.43107 3.52997 6.57934 4.61806 7.32832 5.23242L13.7818 10.5259C14.7277 11.3018 14.7615 12.7375 13.8532 13.5571L7.21268 19.5487C6.54674 20.1495 6.50374 21.18 7.1173 21.8343C7.72152 22.4786 8.73321 22.5123 9.37904 21.9097L18.4327 13.4623C19.2802 12.6716 19.2802 11.3284 18.4327 10.5377Z"
        fill="currentColor"
        stroke="currentColor"
      />
    </svg>
  );
};
