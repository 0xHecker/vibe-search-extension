import React, { useEffect, useRef, useState } from "react";

type IconWithLightFixProps = {
  src?: string;
  alt?: string;
  className?: string;
};

export default function IconWithLightFix({
  src,
  alt,
  className = "w-5 h-5 rounded-sm",
}: IconWithLightFixProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [isLight, setIsLight] = useState(false);

  useEffect(() => {
    if (!src) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = src;

    const onLoad = () => {
      try {
        const width = 32;
        const height = 32;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return setIsLight(false);
        ctx.drawImage(img, 0, 0, width, height);

        const data = ctx.getImageData(0, 0, width, height).data;
        let whitePixelCount = 0;
        let opaquePixelCount = 0;

        for (let i = 0; i < data.length; i += 4) {
          const red = data[i] / 255;
          const green = data[i + 1] / 255;
          const blue = data[i + 2] / 255;
          const alpha = data[i + 3] / 255;
          if (alpha < 0.05) continue;
          opaquePixelCount++;

          const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
          const maxChannel = Math.max(red, green, blue);
          const minChannel = Math.min(red, green, blue);
          const saturationProxy = maxChannel - minChannel;

          if (luminance > 0.88 && saturationProxy < 0.12) whitePixelCount++;
        }

        if (opaquePixelCount === 0) return setIsLight(false);
        const whiteRatio = whitePixelCount / opaquePixelCount;
        setIsLight(whiteRatio > 0.75);
      } catch (_e) {
        setIsLight(false);
      }
    };

    const onError = () => setIsLight(false);

    img.addEventListener("load", onLoad);
    img.addEventListener("error", onError);

    return () => {
      img.removeEventListener("load", onLoad);
      img.removeEventListener("error", onError);
    };
  }, [src]);

  return (
    <img
      ref={imgRef}
      src={src}
      alt={alt}
      className={`${className} ${isLight ? "icon-light-shadow" : ""}`}
      draggable={false}
    />
  );
}
