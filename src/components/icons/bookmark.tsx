import React from "react";

export const Bookmark = ({ className, size = 24 }: { className?: string; size?: number }) => {
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
        d="M8.25 1C5.90279 1 4 2.97011 4 5.40037V20.796C4 22.5779 5.9389 23.6207 7.34694 22.596L11.278 19.7352C12.0113 19.2017 12.9888 19.2017 13.722 19.7352L17.653 22.596C19.061 23.6207 21 22.5779 21 20.796V5.40037C21 2.97011 19.0972 1 16.75 1H8.25Z"
        fill="#C6C6C6"
      />
    </svg>
  );
};
